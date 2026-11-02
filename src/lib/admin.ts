import { randomUUID } from "node:crypto";
import { getCurrentUser, userLabel, type User } from "./auth";
import type { Transaction } from "@libsql/client";
import { appDb, writeTx } from "./db";
import { isAdminEmail } from "./metrics";
import { getPlan } from "./plans";
import { grantDue, startSubscription } from "./subscriptions";

/** Текущий пользователь, если он владелец. Для остальных возвращает null, и страницы показывают 404. */
export async function getAdmin(): Promise<User | null> {
  const u = await getCurrentUser();
  return u && isAdminEmail(u.email) ? u : null;
}

export type AdminUser = {
  id: number; email: string; label: string; balance: number; createdAt: number; unlocks: number; paidRub: number;
  banned: boolean; banReason: string | null; /** владелец (ADMIN_EMAILS): его нельзя блокировать, а его кредиты не входят в учёт */ isAdmin: boolean;
  /** Действующая или ближайшая подписка: тариф, до какого числа оплачено с учётом очереди, есть ли среди них подаренные */
  sub: { title: string; until: number; gift: boolean } | null;
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
  const t = stamp();
  const r = await db.execute({
    sql: `SELECT u.id, u.email, u.tg_username, u.display_name, u.balance, u.created_at, u.banned_at, u.ban_reason,
                 (SELECT count(*) FROM unlocks k WHERE k.user_id = u.id) AS unlocks,
                 (SELECT coalesce(sum(amount_kop), 0) FROM payments p WHERE p.user_id = u.id AND p.status = 'succeeded' AND p.provider = 'yookassa') AS paid,
                 (SELECT s.plan_id FROM subscriptions s WHERE s.user_id = u.id AND s.ends_at > ? ORDER BY s.starts_at, s.id LIMIT 1) AS sub_plan,
                 (SELECT max(s.ends_at) FROM subscriptions s WHERE s.user_id = u.id AND s.ends_at > ?) AS sub_until,
                 (SELECT count(*) FROM subscriptions s WHERE s.user_id = u.id AND s.ends_at > ? AND s.payment_id LIKE '${GIFT}%') AS sub_gifts
          FROM users u ${where ? `WHERE ${where}` : ""} ORDER BY u.id DESC LIMIT ?`,
    args: [t, t, t, ...(raw ? [like, like, ...names] : []), limit],
  });
  return r.rows.map((x) => ({
    id: Number(x.id), email: String(x.email), balance: Number(x.balance),
    label: userLabel(String(x.email), x.tg_username == null ? null : String(x.tg_username), x.display_name == null ? null : String(x.display_name)),
    createdAt: Number(x.created_at), unlocks: Number(x.unlocks), paidRub: Number(x.paid) / 100,
    banned: x.banned_at != null, banReason: x.ban_reason == null ? null : String(x.ban_reason), isAdmin: isAdminEmail(String(x.email)),
    sub: x.sub_plan == null ? null : { title: getPlan(String(x.sub_plan))?.title ?? String(x.sub_plan), until: Number(x.sub_until), gift: Number(x.sub_gifts) > 0 },
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

/** Пользователь по e-mail, @username в Telegram или номеру из списка (№123). Регистр не важен. */
async function findUser(who: string): Promise<{ id: number; key: string } | { error: string }> {
  const key = who.trim().toLowerCase();
  if (!key) return { error: "Укажите e-mail или @username" };
  const db = await appDb();
  const num = /^[№#]?\s*(\d+)$/.exec(key);
  const row = num
    ? (await db.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [Number(num[1])] })).rows[0]
    : key.startsWith("@")
      ? (await db.execute({ sql: "SELECT id FROM users WHERE lower(tg_username) = ?", args: [key.slice(1)] })).rows[0]
      : (await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [key] })).rows[0];
  if (!row) return { error: `Пользователь ${num ? "с таким номером" : key.startsWith("@") ? "с таким @username" : "с таким e-mail"} не найден. Он должен сначала зарегистрироваться.` };
  return { id: Number(row.id), key };
}

/** Начисление или списание по e-mail, @username из Telegram или номеру: удобнее, чем искать человека в списке. */
export async function adjustCreditsByEmail(who: string, delta: number, note: string): Promise<AdjustResult & { email?: string }> {
  const u = await findUser(who);
  if ("error" in u) return { ok: false, error: u.error };
  const r = await adjustCredits(u.id, delta, note);
  return r.ok ? { ...r, email: u.key } : r;
}

/** Подаренные подписки отличаются от оплаченных только началом payment_id: платежа за ними нет. */
const GIFT = "admin:";
export const GIFT_MAX_MONTHS = 24;

export type GiftResult = { ok: true; title: string; months: number; endsAt: number; balance: number } | { ok: false; error: string };

/**
 * Подписка в подарок (себе на тесты, партнёру, в счёт поддержки): работает как оплаченная, но без платежа и чека.
 * Если у человека уже есть подписка, подарок встаёт в очередь после неё; кредиты первого месяца приходят, как только подарок начнётся.
 */
export async function giftSubscription(who: string, planId: string, months: number): Promise<GiftResult> {
  const plan = getPlan(planId);
  if (!plan) return { ok: false, error: "Нет такого тарифа" };
  const m = Number(months);
  if (!Number.isInteger(m) || m < 1 || m > GIFT_MAX_MONTHS) return { ok: false, error: `Срок от 1 до ${GIFT_MAX_MONTHS} месяцев` };
  const u = await findUser(who);
  if ("error" in u) return { ok: false, error: u.error };

  return writeTx<GiftResult>(async (tx) => {
    const row = (await tx.execute({ sql: "SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL", args: [u.id] })).rows[0];
    if (!row) return { value: { ok: false, error: "Пользователь не найден" }, rollback: true };
    const paymentId = GIFT + randomUUID();
    await startSubscription(tx, { userId: u.id, paymentId, planId: plan.id, months: m, creditsTotal: plan.creditsPerMonth * m }, stamp());
    const endsAt = Number((await tx.execute({ sql: "SELECT ends_at FROM subscriptions WHERE payment_id = ?", args: [paymentId] })).rows[0].ends_at);
    const balance = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [u.id] })).rows[0].balance);
    return { value: { ok: true, title: plan.title, months: m, endsAt, balance } };
  });
}

/**
 * Снимает подаренные подписки: права тарифа пропадают сразу, следующие месяцы не придут, подарок в очереди удаляется.
 * Уже начисленные кредиты остаются (забрать их можно отдельно). Оплаченные подписки не трогает: по ним нужен возврат денег.
 */
export async function revokeGifts(userId: number): Promise<{ ok: true; revoked: number } | { ok: false; error: string }> {
  return writeTx<{ ok: true; revoked: number } | { ok: false; error: string }>(async (tx) => {
    const t = stamp();
    const rows = (await tx.execute({ sql: `SELECT id, starts_at FROM subscriptions WHERE user_id = ? AND ends_at > ? AND payment_id LIKE '${GIFT}%'`, args: [userId, t] })).rows;
    if (rows.length === 0) return { value: { ok: false, error: "Подаренной подписки нет" }, rollback: true };
    for (const r of rows) {
      if (Number(r.starts_at) > t) await tx.execute({ sql: "DELETE FROM subscriptions WHERE id = ?", args: [r.id] });
      else await tx.execute({ sql: "UPDATE subscriptions SET months = granted, ends_at = ? WHERE id = ?", args: [t, r.id] });
    }
    await grantDue(tx, userId, t); // пересчитать, когда ждать следующих кредитов
    return { value: { ok: true, revoked: rows.length } };
  });
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
