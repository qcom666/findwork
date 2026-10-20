import { appDb } from "./db";

/**
 * Лимит запросов, который переживает перезапуск сервера: счётчики лежат в базе приложения.
 * На Vercel процессы короткоживущие, поэтому лимит в памяти там почти ничего не защищает.
 * Возвращает true, если запрос разрешён.
 */
export async function allow(key: string, limit: number, windowSec = 3600): Promise<boolean> {
  const db = await appDb();
  const now = Math.floor(Date.now() / 1000);
  const r = await db.execute({
    sql: `INSERT INTO rate_limits(key, n, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            n = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.n + 1 END,
            reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
          RETURNING n`,
    args: [key, now + windowSec, now, now, now + windowSec],
  });
  if (Math.random() < 0.01) {
    await db.execute({ sql: "DELETE FROM rate_limits WHERE reset_at < ?", args: [now] }).catch(() => {});
  }
  return Number(r.rows[0].n) <= limit;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
