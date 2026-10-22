import { appDb } from "./db";

/**
 * Лимит запросов, который переживает перезапуск сервера: счётчики лежат в базе приложения.
 * На Vercel процессы короткоживущие, поэтому лимит в памяти там почти ничего не защищает.
 * Возвращает true, если запрос разрешён. cost: сколько единиц лимита тратит запрос (пакет питчей тратит по числу лидов).
 */
export async function allow(key: string, limit: number, windowSec = 3600, cost = 1): Promise<boolean> {
  const db = await appDb();
  const now = Math.floor(Date.now() / 1000);
  const r = await db.execute({
    sql: `INSERT INTO rate_limits(key, n, reset_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            n = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.n + ? END,
            reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
          RETURNING n`,
    args: [key, cost, now + windowSec, now, cost, cost, now, now + windowSec],
  });
  if (Math.random() < 0.01) {
    await db.execute({ sql: "DELETE FROM rate_limits WHERE reset_at < ?", args: [now] }).catch(() => {});
  }
  return Number(r.rows[0].n) <= limit;
}

/**
 * IP посетителя. Через наш прокси в России (lidomap.ru → сервер в Москве → Vercel) Vercel видит адрес прокси,
 * поэтому прокси передаёт настоящий адрес в X-Lidomap-Client-IP вместе с общим секретом PROXY_SECRET.
 * Без верного секрета заголовку не верим: иначе любой мог бы подставить чужой адрес и обойти лимиты.
 */
export function clientIp(req: Request): string {
  const secret = process.env.PROXY_SECRET;
  if (secret && req.headers.get("x-lidomap-proxy") === secret) {
    const ip = req.headers.get("x-lidomap-client-ip")?.trim();
    if (ip) return ip;
  }
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
