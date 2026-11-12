import { cached } from "./cache";
import { matchNiches } from "./niche-search";
import { getAllCities } from "./seo";
import { claimedByOthers } from "./claims";
import { unlockedAmong } from "./credits";
import { appDb, leadsDb } from "./db";
import { hiddenCatalogLeadIds } from "./crm";
import { maskEmail, maskPhone, socialNames } from "./mask";

export type SiteKind = "none" | "social" | "builder" | "real";

export type Lead = {
  id: string;
  name: string;
  niche: string;
  category: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  siteKind: SiteKind;
  isChain: boolean;
  confidence: number | null;
  sources: string[];
  score: number;
  services: string[];
  /** Контакты открыты для текущего пользователя. Пока нет, поля ниже пустые, а наружу идут только превью. */
  unlocked: boolean;
  /** Другой пользователь держит заведение в эксклюзиве до этого момента (unix-секунды): открыть его нельзя. Для открытых и свободных null. */
  claimedUntil: number | null;
  has: { phone: boolean; email: boolean; social: boolean; website: boolean };
  preview: { phone: string | null; email: string | null; socials: string[] };
  phone: string | null;
  phones: string[];
  email: string | null;
  website: string | null;
  socials: string[];
};

type Row = {
  id: string; name: string; niche: string; category: string | null; city: string | null; address: string | null;
  lat: number | null; lon: number | null; phone: string | null; phones: string | null; email: string | null;
  website: string | null; site_kind: SiteKind; socials: string | null; is_chain: number; confidence: number | null;
  sources: string | null; score: number; services: string | null;
};

function parseList(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Единственное место, где контакты выпускаются наружу: без unlocked=true они вырезаются здесь. */
function toLead(r: Row, unlocked: boolean, claimedUntil: number | null = null): Lead {
  const phones = parseList(r.phones);
  const socials = parseList(r.socials);
  return {
    id: r.id, name: r.name, niche: r.niche, category: r.category, city: r.city, address: r.address,
    lat: r.lat, lon: r.lon, siteKind: r.site_kind, isChain: r.is_chain === 1, confidence: r.confidence,
    sources: r.sources ? r.sources.split(",") : [], score: r.score, services: r.services ? r.services.split(",") : [],
    unlocked,
    claimedUntil: unlocked ? null : claimedUntil,
    has: { phone: !!r.phone, email: !!r.email, social: socials.length > 0, website: !!r.website },
    preview: { phone: maskPhone(r.phone), email: maskEmail(r.email), socials: socialNames(socials) },
    phone: unlocked ? r.phone : null,
    phones: unlocked ? phones : [],
    email: unlocked ? r.email : null,
    website: unlocked ? r.website : null,
    socials: unlocked ? socials : [],
  };
}

export type SiteFilter = "need" | "none" | "social" | "builder" | "real" | "any";

export type Sort = "score" | "name";

export type Params = {
  city: string;
  niche: string;
  /** Услуга, которую фрилансер может предложить: id из services (site, qr_menu, booking...). */
  service: string;
  site: SiteFilter;
  minScore: number;
  sort: Sort;
  phone: boolean;
  email: boolean;
  social: boolean;
  chains: boolean;
  q: string;
  page: number;
};

export const SERVICE_IDS = ["site", "redesign", "qr_menu", "booking", "smm", "logo", "signage", "seo", "shop"] as const;
export const MIN_SCORES = [0, 40, 50, 60, 70, 80] as const;

export const PAGE_SIZE = 30;

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseParams(sp: RawParams): Params {
  const site = one(sp.site) as SiteFilter;
  const page = Math.max(1, Math.min(5000, parseInt(one(sp.page), 10) || 1));
  const service = one(sp.service);
  const minScore = parseInt(one(sp.min), 10);
  return {
    city: one(sp.city).slice(0, 80),
    niche: one(sp.niche).slice(0, 40),
    service: (SERVICE_IDS as readonly string[]).includes(service) ? service : "",
    site: ["need", "none", "social", "builder", "real", "any"].includes(site) ? site : "need",
    minScore: (MIN_SCORES as readonly number[]).includes(minScore) ? minScore : 0,
    sort: one(sp.sort) === "name" ? "name" : "score",
    phone: one(sp.phone) === "1",
    email: one(sp.email) === "1",
    social: one(sp.social) === "1",
    chains: one(sp.chains) === "1",
    q: one(sp.q).slice(0, 80),
    page,
  };
}

export function toQuery(p: Partial<Params>): string {
  const u = new URLSearchParams();
  if (p.city) u.set("city", p.city);
  if (p.niche) u.set("niche", p.niche);
  if (p.service) u.set("service", p.service);
  if (p.site && p.site !== "need") u.set("site", p.site);
  if (p.minScore) u.set("min", String(p.minScore));
  if (p.sort && p.sort !== "score") u.set("sort", p.sort);
  if (p.phone) u.set("phone", "1");
  if (p.email) u.set("email", "1");
  if (p.social) u.set("social", "1");
  if (p.chains) u.set("chains", "1");
  if (p.q) u.set("q", p.q);
  if (p.page && p.page > 1) u.set("page", String(p.page));
  return u.toString();
}

function ftsQuery(q: string): string | null {
  const tokens = q.match(/[\p{L}\p{N}]+/gu);
  if (!tokens) return null;
  return tokens.slice(0, 6).map((t) => `"${t}"*`).join(" ");
}

function where(p: Params, niches: string[] = [], hiddenIds: string[] = []): { sql: string; args: (string | number)[] } {
  const w: string[] = [];
  const a: (string | number)[] = [];
  if (p.city) { w.push("p.city = ?"); a.push(p.city); }
  if (p.niche) { w.push("p.niche = ?"); a.push(p.niche); }
  if (p.service) { w.push("(',' || p.services || ',') LIKE ?"); a.push(`%,${p.service},%`); }
  if (p.minScore) { w.push("p.score >= ?"); a.push(p.minScore); }
  switch (p.site) {
    case "need": w.push("p.site_kind IN ('none','social')"); break;
    case "any": break;
    default: w.push("p.site_kind = ?"); a.push(p.site);
  }
  if (p.phone) w.push("p.has_phone = 1");
  if (p.email) w.push("p.has_email = 1");
  if (p.social) w.push("p.has_social = 1");
  if (!p.chains) w.push("p.is_chain = 0");
  if (hiddenIds.length) {
    w.push(`p.id NOT IN (${hiddenIds.map(() => "?").join(",")})`);
    a.push(...hiddenIds);
  }
  const fts = p.q ? ftsQuery(p.q) : null;
  if (fts) {
    // Слово ищем и в названиях, и среди подходящих ниш: «вывески» найдёт и «Вывески Плюс», и всю нишу рекламы.
    if (niches.length) {
      w.push(`(p.rowid IN (SELECT rowid FROM places_fts WHERE places_fts MATCH ?) OR p.niche IN (${niches.map(() => "?").join(",")}))`);
      a.push(fts, ...niches);
    } else {
      w.push("p.rowid IN (SELECT rowid FROM places_fts WHERE places_fts MATCH ?)");
      a.push(fts);
    }
  }
  return { sql: w.length ? "WHERE " + w.join(" AND ") : "", args: a };
}

const rows = (rs: { rows: unknown[] }) => rs.rows as unknown as Row[];

/**
 * Самые частые выдачи (весь каталог, один город или одна ниша с настройками по умолчанию) считаем по готовым
 * таблицам niches и cities, а не обходом 400 тысяч строк в удалённой базе.
 */
async function fastTotal(p: Params): Promise<number | null> {
  if (p.site !== "need" || p.chains || p.phone || p.email || p.social || p.service || p.minScore || p.q) return null;
  if (p.city && p.niche) return null;
  if (p.niche) return (await getNiches()).find((n) => n.id === p.niche)?.nNeed ?? null;
  if (p.city) return (await getAllCities()).find((c) => c.name === p.city)?.nNeed ?? null;
  return (await getNiches()).reduce((a, n) => a + n.nNeed, 0);
}

/** Дальше этого числа точно считать незачем: так «непопулярные» сочетания фильтров не заставляют обходить весь каталог. */
const countCap = () => Number(process.env.COUNT_CAP) || 10_000;

async function totalFor(p: Params, sql: string, args: (string | number)[], hasHidden: boolean): Promise<{ total: number; capped: boolean }> {
  // Число найденных не меняется между сборками базы, поэтому листание страниц не пересчитывает его заново.
  return cached(`total:${sql}:${JSON.stringify(args)}`, 10 * 60 * 1000, async () => {
    const fast = hasHidden ? null : await fastTotal(p);
    if (fast !== null) return { total: fast, capped: false };
    const cap = countCap();
    const r = await leadsDb().execute({
      sql: `SELECT count(*) AS n FROM (SELECT 1 FROM places p ${sql} LIMIT ?)`,
      args: [...args, cap + 1],
    });
    const n = Number(r.rows[0].n);
    return n > cap ? { total: cap, capped: true } : { total: n, capped: false };
  });
}

/** Заведения в чужом эксклюзиве. Ошибка базы аккаунтов не должна ронять каталог: тогда считаем, что закрытых нет. */
async function closedLeads(userId: number | null | undefined, ids: string[]): Promise<Map<string, number>> {
  try {
    return await claimedByOthers(await appDb(), userId ?? undefined, ids);
  } catch {
    return new Map();
  }
}

export async function searchLeads(p: Params, userId?: number | null): Promise<{ leads: Lead[]; total: number; capped: boolean; matchedNiches: string[] }> {
  const db = leadsDb();
  const [matchedNiches, hiddenIds] = await Promise.all([
    p.q ? matchNiches(p.q, await getNiches()) : [],
    hiddenCatalogLeadIds(userId),
  ]);
  const { sql, args } = where(p, matchedNiches, hiddenIds);
  const [count, page] = await Promise.all([
    totalFor(p, sql, args, hiddenIds.length > 0),
    db.execute({
      sql: `SELECT p.* FROM places p ${sql} ORDER BY ${p.sort === "name" ? "p.name" : "p.score DESC"}, p.rowid LIMIT ? OFFSET ?`,
      args: [...args, PAGE_SIZE, (p.page - 1) * PAGE_SIZE],
    }),
  ]);
  const list = rows(page);
  const ids = list.map((r) => r.id);
  const [open, closed] = await Promise.all([unlockedAmong(userId, ids), closedLeads(userId, ids)]);
  return { leads: list.map((r) => toLead(r, open.has(r.id), closed.get(r.id) ?? null)), total: count.total, capped: count.capped, matchedNiches };
}

/** Заведение для показа пользователю: контакты только если он их открыл. */
export async function getLead(id: string, userId?: number | null): Promise<Lead | null> {
  const rs = await leadsDb().execute({ sql: "SELECT * FROM places WHERE id = ?", args: [id] });
  const r = rows(rs)[0];
  if (!r) return null;
  const [open, closed] = await Promise.all([unlockedAmong(userId, [id]), closedLeads(userId, [id])]);
  return toLead(r, open.has(id), closed.get(id) ?? null);
}

/** Заведение с контактами. Вызывать только после проверки, что пользователь его открыл. */
export async function getLeadsUnlocked(ids: string[]): Promise<Lead[]> {
  if (!ids.length) return [];
  const rs = await leadsDb().execute({
    sql: `SELECT * FROM places WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  const byId = new Map(rows(rs).map((r) => [r.id, toLead(r, true)]));
  return ids.map((id) => byId.get(id)).filter((l): l is Lead => !!l);
}

/** Какие из переданных id есть в каталоге. */
export async function existingIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rs = await leadsDb().execute({ sql: `SELECT id FROM places WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids });
  return rs.rows.map((r) => String(r.id));
}

export async function leadExists(id: string): Promise<boolean> {
  const rs = await leadsDb().execute({ sql: "SELECT 1 FROM places WHERE id = ?", args: [id] });
  return rs.rows.length > 0;
}

export type Option = { id: string; label: string; n: number; nNeed: number };

async function loadNiches(): Promise<Option[]> {
  const rs = await leadsDb().execute("SELECT id, label, n, n_need FROM niches WHERE n > 0 ORDER BY n_need DESC");
  return rs.rows.map((r) => ({ id: String(r.id), label: String(r.label), n: Number(r.n), nNeed: Number(r.n_need) }));
}

async function loadCities(limit: number): Promise<Option[]> {
  const rs = await leadsDb().execute({ sql: "SELECT name, n, n_need FROM cities ORDER BY n DESC LIMIT ?", args: [limit] });
  return rs.rows.map((r) => ({ id: String(r.name), label: String(r.name), n: Number(r.n), nNeed: Number(r.n_need) }));
}

async function loadLabels(): Promise<{ niches: Record<string, string>; services: Record<string, string> }> {
  const db = leadsDb();
  const [n, s] = await Promise.all([db.execute("SELECT id, label FROM niches"), db.execute("SELECT id, label FROM services")]);
  const niches: Record<string, string> = {};
  const services: Record<string, string> = {};
  for (const r of n.rows) niches[String(r.id)] = String(r.label);
  for (const r of s.rows) services[String(r.id)] = String(r.label);
  return { niches, services };
}

async function loadMeta(): Promise<Record<string, string>> {
  const rs = await leadsDb().execute("SELECT key, value FROM meta");
  const out: Record<string, string> = {};
  for (const r of rs.rows) out[String(r.key)] = String(r.value);
  return out;
}

export type Stats = { places: number; candidates: number; cities: number; niches: number };

/** Цифры для главной страницы. */
async function loadStats(): Promise<Stats> {
  const db = leadsDb();
  const [m, n, c] = await Promise.all([
    db.execute("SELECT value FROM meta WHERE key = 'total'"),
    db.execute("SELECT count(*) AS k, coalesce(sum(n_need), 0) AS need FROM niches WHERE n > 0"),
    db.execute("SELECT count(*) AS k FROM cities"),
  ]);
  return {
    places: Number(m.rows[0]?.value ?? 0),
    candidates: Number(n.rows[0].need),
    cities: Number(c.rows[0].k),
    niches: Number(n.rows[0].k),
  };
}

// Справочники меняются раз в сборку базы, поэтому держим их в памяти десять минут.
const TTL = 10 * 60 * 1000;
export const getNiches = (): Promise<Option[]> => cached("niches", TTL, loadNiches);
export const getCities = (limit = 200): Promise<Option[]> => cached(`cities:${limit}`, TTL, () => loadCities(limit));
export const getLabels = () => cached("labels", TTL, loadLabels);
export const getMeta = (): Promise<Record<string, string>> => cached("meta", TTL, loadMeta);
export const getStats = (): Promise<Stats> => cached("stats", TTL, loadStats);
