import { getCurrentUser, userLabel, type User } from "./auth";
import type { Transaction } from "@libsql/client";
import { appDb, writeTx } from "./db";
import { isAdminEmail } from "./metrics";

/** Текущий пользователь, если он владелец. Для остальных возвращает null, и страницы показывают 404. */
export async function getAdmin(): Promise<User | null> {
  const u = await getCurrentUser();
  return u && isAdminEmail(u.email) ? u : null;
}

export type AdminUser = {
  id: number; email: string; label: string; balance: number; createdAt: number; unlocks: number; paidRub: number;
  banned: boolean; banReason: string | null; /** владелец (ADMIN_EMAILS): его нельзя блокировать, а его кредиты не входят в учёт */ isAdmin: boolean;
};

/**
 * Поиск по части e-mail, имени или @username в Telegram. Спецсимволы LIKE экранируются, чтобы «%» не находил всех.
 * LIKE в SQLite игнорирует регистр только у латиницы, поэтому для имён пробуем и как набрано, и с заглавными: «анна петрова» найдёт «Анна Петрова».
 */
export async function searchUsers(q: string, limit = 50, opts: { onlyBanned?: boolean } = {}): Promise<AdminUser[]> {
  const db = await appDb();
  const raw = q.trim().replace(/^@/, "");
  const esc = (t: string) => t.replace(/[\\%_]/g, (c) => "\\" + c);
  const low = raw.toLowerCase();
  const cap = low.charAt(0).toUpperCase() + low.slice(1);
  const title = low.replace(/(^|\s)(\S)/g, (_, sp: string, ch: string) => sp + ch.toUpperCase());
  const names = [...new Set([raw, low, cap, title])].map((t) => `%${esc(t)}%`);
  const like = `%${esc(low)}%`;
  const match = raw
    ? `(u.email LIKE ? ESCAPE '\\' OR u.tg_username LIKE ? ESCAPE '\\' OR ${names.map(() => "u.display_name LIKE ? ESCAPE '\\'").join(" OR ")})`
    : "";
  const where = ["u.deleted_at IS NULL", match, opts.onlyBanned ? "u.banned_at IS NOT NULL" : ""].filter(Boolean).join(" AND ");
  const r = await db.execute({
    sql: `SELECT u.id, u.email, u.tg_username, u.display_name, u.balance, u.created_at, u.banned_at, u.ban_reason,
                 (SELECT count(*) FROM unlocks k WHERE k.user_id = u.id) AS unlocks,
                 (SELECT coalesce(sum(amount_kop), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded' AND p.provider = 'yookassa') AS paid
          FROM users u ${where ? `WHERE ${where}` : ""} ORDER BY u.id DESC LIMIT ?`,
    args: raw ? [like, like, ...names, limit] : [limit],
  });
  return r.rows.map((x) => ({
    id: Number(x.id), email: String(x.email), balance: Number(x.balance),
    label: userLabel(String(x.email), x.tg_username == null ? null : String(x.tg_username), x.display_name == null ? null : String(x.display_name)),
    createdAt: Number(x.created_at), unlocks: Number(x.unlocks), paidRub: Number(x.paid) / 100,
    banned: x.banned_at != null, banReason: x.ban_reason == null ? null : String(x.ban_reason), isAdmin: isAdminEmail(String(x.email)),
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

export type ModerationResult = { ok: true; balance: number } | { ok: false; error: string };

const stamp = () => Math.floor(Date.now() / 1000);

/** Списывает все кредиты пользователя в ноль одной проводкой «admin»; прежняя история остаётся. */
async function zeroIn(tx: Transaction, userId: number, note: string): Promise<number> {
  const balance = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] })).rows[0]?.balance ?? 0);
  if (balance > 0) {
    await tx.execute({ sql: "UPDATE users SET balance = 0 WHERE id = ?", args: [userId] });
    await tx.execute({
      sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'admin', ?, ?)",
      args: [userId, -balance, note.trim().slice(0, 100) || "Обнуление баланса", stamp()],
    });
  }
  return balance;
}

/** Забрать у пользователя все кредиты. Владельцу не нужно: его кредиты не входят в учёт. */
export async function zeroCredits(userId: number, note: string): Promise<ModerationResult & { taken?: number }> {
  return writeTx<ModerationResult & { taken?: number }>(async (tx) => {
    const row = (await tx.execute({ sql: "SELECT 1 FROM users WHERE id = ?", args: [userId] })).rows[0];
    if (!row) return { value: { ok: false, error: "Пользователь не найден" }, rollback: true };
    const taken = await zeroIn(tx, userId, note);
    return { value: { ok: true, balance: 0, taken } };
  });
}

/**
 * Блокировка: человек не может войти и пользоваться сайтом, его сессии закрываются, ссылки на сброс пароля гасятся.
 * Его эксклюзивы освобождаются (другие смогут открыть заведения), а страницы отчётов закрываются: заблокированному
 * нельзя оставлять публичные страницы со своими контактами. zero: заодно забрать все кредиты.
 * Владельца (ADMIN_EMAILS) заблокировать нельзя.
 */
export async function banUser(userId: number, reason: string, opts: { zero?: boolean } = {}): Promise<ModerationResult & { taken?: number }> {
  return writeTx<ModerationResult & { taken?: number }>(async (tx) => {
    const row = (await tx.execute({ sql: "SELECT email FROM users WHERE id = ?", args: [userId] })).rows[0];
    if (!row) return { value: { ok: false, error: "Пользователь не найден" }, rollback: true };
    if (isAdminEmail(String(row.email))) return { value: { ok: false, error: "Владельца заблокировать нельзя" }, rollback: true };

    await tx.execute({ sql: "UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?", args: [stamp(), reason.trim().slice(0, 200) || null, userId] });
    await tx.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] });
    await tx.execute({ sql: "UPDATE password_resets SET used = 1 WHERE user_id = ?", args: [userId] });
    await tx.execute({ sql: "DELETE FROM lead_claims WHERE user_id = ?", args: [userId] });
    await tx.execute({ sql: "UPDATE audit_reports SET revoked = 1 WHERE user_id = ?", args: [userId] });
    const taken = opts.zero ? await zeroIn(tx, userId, "Блокировка: кредиты забраны") : 0;
    const balance = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] })).rows[0].balance);
    return { value: { ok: true, balance, taken } };
  });
}

/** Снимает блокировку. Забранные кредиты и закрытые отчёты не возвращаются: это решает владелец вручную. */
export async function unbanUser(userId: number): Promise<{ ok: boolean }> {
  const db = await appDb();
  const r = await db.execute({ sql: "UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ? AND banned_at IS NOT NULL", args: [userId] });
  return { ok: r.rowsAffected === 1 };
}
