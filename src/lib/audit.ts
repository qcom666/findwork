import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export type Finding = { level: "bad" | "warn" | "ok" | "info"; text: string };

export type AuditResult = {
  url: string;
  reachable: boolean;
  finalUrl?: string;
  status?: number;
  ms?: number;
  https?: boolean;
  title?: string;
  builder?: string;
  lastYear?: number;
  findings: Finding[];
  error?: string;
};

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    if (/^f[cd]/.test(l) || /^fe[89ab]/.test(l)) return true;
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivate(m[1]) : false;
  }
  return true;
}

type Fetched = { status: number; body: string; finalUrl: URL; ms: number; certError?: string };

const CERT_ERRORS = new Set([
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

function requestOnce(url: URL, ip: { address: string; family: number }, insecure: boolean) {
  return new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        host: url.hostname,
        servername: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: "GET",
        timeout: 8000,
        rejectUnauthorized: !insecure,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FindWorkAudit/0.1)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Encoding": "identity",
        },
        // Адрес уже проверен выше; закрепляем его, чтобы DNS-ответ не подменили между проверкой и запросом.
        lookup: (_h, opts, cb) => {
          if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: unknown) => void)(null, [{ address: ip.address, family: ip.family }]);
          else cb(null, ip.address, ip.family);
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          resolve({ status: res.statusCode ?? 0, location: res.headers.location, body: Buffer.concat(chunks).toString("utf8") });
        };
        res.on("data", (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          // Для аудита хватает начала страницы: дочитывать мегабайты незачем.
          if (size > 400_000) {
            done();
            res.destroy();
          }
        });
        res.on("end", done);
        res.on("close", done);
        res.on("error", () => done());
      },
    );
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}

async function fetchPage(start: string): Promise<Fetched> {
  let url = new URL(start);
  const t0 = Date.now();
  let certError: string | undefined;
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("BAD_PROTOCOL");
    if (url.port && url.port !== "80" && url.port !== "443") throw new Error("BAD_PORT");
    const addrs = await dns.lookup(url.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error("BLOCKED_ADDRESS");
    let r;
    try {
      r = await requestOnce(url, addrs[0], false);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (url.protocol === "https:" && CERT_ERRORS.has(code)) {
        certError = code;
        r = await requestOnce(url, addrs[0], true);
      } else throw e;
    }
    if ([301, 302, 303, 307, 308].includes(r.status) && r.location) {
      url = new URL(r.location, url);
      continue;
    }
    return { status: r.status, body: r.body, finalUrl: url, ms: Date.now() - t0, certError };
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

const BUILDERS: [RegExp, string][] = [
  [/tilda\.(ws|cc)|t-store|tildacdn/i, "Tilda"],
  [/wixstatic|wix\.com|_wixCIDX/i, "Wix"],
  [/wp-content|wp-includes/i, "WordPress"],
  [/bitrix|\/bitrix\//i, "1С-Битрикс"],
  [/nethouse|nethouse\.id/i, "Nethouse"],
  [/ucoz|ucoz\.ru/i, "uCoz"],
  [/opencart|index\.php\?route=/i, "OpenCart"],
  [/joomla/i, "Joomla"],
  [/flexbe/i, "Flexbe"],
  [/webflow/i, "Webflow"],
  [/taplink/i, "Taplink"],
];

function errText(code: string): string {
  switch (code) {
    case "ENOTFOUND": case "EAI_AGAIN": return "домен не найден или не отвечает";
    case "ECONNREFUSED": return "сервер отказал в соединении";
    case "ECONNRESET": return "соединение оборвалось";
    case "TIMEOUT": case "ETIMEDOUT": return "сервер не ответил за 8 секунд";
    case "BLOCKED_ADDRESS": return "адрес недоступен для проверки";
    case "TOO_MANY_REDIRECTS": return "слишком много перенаправлений";
    default: return "не удалось открыть страницу";
  }
}

export async function auditSite(url: string): Promise<AuditResult> {
  const out: AuditResult = { url, reachable: false, findings: [] };
  let page: Fetched;
  try {
    page = await fetchPage(url);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
    out.error = errText(code);
    out.findings.push({ level: "bad", text: `Сайт не открывается: ${out.error}` });
    return out;
  }

  const html = page.body;
  out.reachable = page.status >= 200 && page.status < 400;
  out.status = page.status;
  out.ms = page.ms;
  out.finalUrl = page.finalUrl.toString();
  out.https = page.finalUrl.protocol === "https:";

  const f = out.findings;
  if (!out.reachable) f.push({ level: "bad", text: `Сервер отвечает ошибкой ${page.status}` });
  if (page.certError) f.push({ level: "bad", text: "Недействительный сертификат: браузер покажет предупреждение о безопасности" });
  else if (out.https) f.push({ level: "ok", text: "Работает по HTTPS" });
  else f.push({ level: "warn", text: "Нет HTTPS: браузер пишет «Небезопасно»" });

  if (page.ms > 3500) f.push({ level: "warn", text: `Медленный ответ: ${(page.ms / 1000).toFixed(1)} с до получения страницы` });

  if (/<meta[^>]+name=["']viewport["']/i.test(html)) f.push({ level: "ok", text: "Есть адаптация под телефон (meta viewport)" });
  else f.push({ level: "bad", text: "Нет адаптации под телефон: на смартфоне сайт, скорее всего, открывается мелким" });

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  out.title = title?.slice(0, 120);
  if (!title || title.length < 8) f.push({ level: "warn", text: "Пустой или слишком короткий заголовок страницы (title): плохо для поиска" });

  if (!/<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(html))
    f.push({ level: "warn", text: "Нет описания страницы для поиска (meta description)" });

  if (!/href=["']tel:/i.test(html)) f.push({ level: "warn", text: "Нет кликабельного телефона: с мобильного нельзя позвонить одним нажатием" });

  const years = [...html.matchAll(/(?:©|&copy;|copyright)[^<]{0,40}?((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi)];
  if (years.length) {
    const last = Math.max(...years.map((m) => parseInt(m[2] ?? m[1], 10)));
    out.lastYear = last;
    const now = new Date().getFullYear();
    if (last <= now - 2) f.push({ level: "warn", text: `В подвале указан © ${last}: сайт выглядит заброшенным` });
  }

  const b = BUILDERS.find(([re]) => re.test(html));
  if (b) {
    out.builder = b[1];
    f.push({ level: "info", text: `Похоже, сайт сделан на ${b[1]}` });
  }
  return out;
}
