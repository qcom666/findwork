import { getCurrentUser, type User } from "./auth";
import { appDb, writeTx } from "./db";
import { isAdminEmail } from "./metrics";

/** Текущий пользователь, если он владелец. Для остальных возвращает null, и страницы показывают 404. */
export async function getAdmin(): Promise<User | null> {
  const u = await getCurrentUser();
  return u && isAdminEmail(u.email) ? u : null;
}

export type AdminUser = { id: number; email: string; balance: number; createdAt: number; unlocks: number; paidRub: number };

/** Поиск по части e-mail. Спецсимволы LIKE экранируются, чтобы «%» не находил всех. */
export async function searchUsers(q: string, limit = 50): Promise<AdminUser[]> {
  const db = await appDb();
  const term = q.trim().toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c);
  const r = await db.execute({
    sql: `SELECT u.id, u.email, u.balance, u.created_at,
                 (SELECT count(*) FROM unlocks k WHERE k.user_id = u.id) AS unlocks,
                 (SELECT coalesce(sum(amount_kop), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded' AND p.provider = 'yookassa') AS paid
          FROM users u ${term ? "WHERE u.email LIKE ? ESCAPE '\\'" : ""} ORDER BY u.id DESC LIMIT ?`,
    args: term ? [`%${term}%`, limit] : [limit],
  });
  return r.rows.map((x) => ({
    id: Number(x.id), email: String(x.email), balance: Number(x.balance), createdAt: Number(x.created_at), unlocks: Number(x.unlocks), paidRub: Number(x.paid) / 100,
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

/** Начисление или списание по e-mail: удобнее, чем искать человека в списке. Регистр не важен. */
export async function adjustCreditsByEmail(email: string, delta: number, note: string): Promise<AdjustResult & { email?: string }> {
  const mail = email.trim().toLowerCase();
  if (!mail) return { ok: false, error: "Укажите e-mail" };
  const db = await appDb();
  const row = (await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [mail] })).rows[0];
  if (!row) return { ok: false, error: "Пользователь с таким e-mail не найден. Он должен сначала зарегистрироваться." };
  const r = await adjustCredits(Number(row.id), delta, note);
  return r.ok ? { ...r, email: mail } : r;
}
