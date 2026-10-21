import { getCurrentUser, userLabel, type User } from "./auth";
import { appDb, writeTx } from "./db";
import { isAdminEmail } from "./metrics";

/** Текущий пользователь, если он владелец. Для остальных возвращает null, и страницы показывают 404. */
export async function getAdmin(): Promise<User | null> {
  const u = await getCurrentUser();
  return u && isAdminEmail(u.email) ? u : null;
}

export type AdminUser = { id: number; email: string; label: string; balance: number; createdAt: number; unlocks: number; paidRub: number };

/**
 * Поиск по части e-mail, имени или @username в Telegram. Спецсимволы LIKE экранируются, чтобы «%» не находил всех.
 * LIKE в SQLite игнорирует регистр только у латиницы, поэтому для имён пробуем и как набрано, и с заглавными: «анна петрова» найдёт «Анна Петрова».
 */
export async function searchUsers(q: string, limit = 50): Promise<AdminUser[]> {
  const db = await appDb();
  const raw = q.trim().replace(/^@/, "");
  const esc = (t: string) => t.replace(/[\\%_]/g, (c) => "\\" + c);
  const low = raw.toLowerCase();
  const cap = low.charAt(0).toUpperCase() + low.slice(1);
  const title = low.replace(/(^|\s)(\S)/g, (_, sp: string, ch: string) => sp + ch.toUpperCase());
  const names = [...new Set([raw, low, cap, title])].map((t) => `%${esc(t)}%`);
  const like = `%${esc(low)}%`;
  const where = raw
    ? `WHERE u.email LIKE ? ESCAPE '\\' OR u.tg_username LIKE ? ESCAPE '\\' OR ${names.map(() => "u.display_name LIKE ? ESCAPE '\\'").join(" OR ")}`
    : "";
  const r = await db.execute({
    sql: `SELECT u.id, u.email, u.tg_username, u.display_name, u.balance, u.created_at,
                 (SELECT count(*) FROM unlocks k WHERE k.user_id = u.id) AS unlocks,
                 (SELECT coalesce(sum(amount_kop), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded' AND p.provider = 'yookassa') AS paid
          FROM users u ${where} ORDER BY u.id DESC LIMIT ?`,
    args: raw ? [like, like, ...names, limit] : [limit],
  });
  return r.rows.map((x) => ({
    id: Number(x.id), email: String(x.email), balance: Number(x.balance),
    label: userLabel(String(x.email), x.tg_username == null ? null : String(x.tg_username), x.display_name == null ? null : String(x.display_name)),
    createdAt: Number(x.created_at), unlocks: Number(x.unlocks), paidRub: Number(x.paid) / 100,
  }));
}

export type AdjustResult = { ok: true; balance: number } | { ok: false; error: string };

/** Ручное начисление или списание кредитов (поддержка, возврат, подарок). Баланс не уходит ниже нуля. */
export async function adjustCredits(userId: number, delta: number, note: string): Promise<AdjustResult> {
  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) return { ok: false, error: "Укажите число кредитов, не ноль" };
  if (Math.abs(d) > 10000) return { ok: false, error: "Не больше 10 000 кредитов за раз" };

  return writeTx<AdjustResult>(async (tx) => {
    const row = (await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] })).rows[0];
    if (!row) return { value: { ok: false, error: "Пользователь не найден" }, rollback: true };
    const balance = Number(row.balance);
    if (balance + d < 0) return { value: { ok: false, error: `У пользователя ${balance}, списать ${-d} нельзя` }, rollback: true };
    await tx.execute({ sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [d, userId] });
    await tx.execute({
      sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'admin', ?, ?)",
      args: [userId, d, note.trim().slice(0, 100) || null, Math.floor(Date.now() / 1000)],
    });
    return { value: { ok: true, balance: balance + d } };
  });
}

/** Начисление или списание по e-mail или @username из Telegram: удобнее, чем искать человека в списке. Регистр не важен. */
export async function adjustCreditsByEmail(who: string, delta: number, note: string): Promise<AdjustResult & { email?: string }> {
  const key = who.trim().toLowerCase();
  if (!key) return { ok: false, error: "Укажите e-mail или @username" };
  const db = await appDb();
  const row = key.startsWith("@")
    ? (await db.execute({ sql: "SELECT id FROM users WHERE lower(tg_username) = ?", args: [key.slice(1)] })).rows[0]
    : (await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [key] })).rows[0];
  if (!row) return { ok: false, error: `Пользователь ${key.startsWith("@") ? "с таким @username" : "с таким e-mail"} не найден. Он должен сначала зарегистрироваться.` };
  const r = await adjustCredits(Number(row.id), delta, note);
  return r.ok ? { ...r, email: key } : r;
}
