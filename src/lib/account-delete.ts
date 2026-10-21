import { createHash } from "node:crypto";
import { writeTx } from "./db";
import { isAdminEmail } from "./metrics";
import { isTgEmail } from "./telegram";

const now = () => Math.floor(Date.now() / 1000);
const YEAR = 365 * 86400;

/** Необратимый отпечаток идентификатора для защиты от повторного получения бонуса. */
export const identityHash = (kind: "email" | "tg", value: string | number) =>
  createHash("sha256").update(`findwork-identity:${kind}:${String(value).trim().toLowerCase()}`).digest("hex");

/** Хеши, по которым ищем «возвращающегося» человека: настоящая почта и/или Telegram. */
export function identityHashes(email: string, tgId?: number | null): string[] {
  return [...(isTgEmail(email) ? [] : [identityHash("email", email)]), ...(tgId != null ? [identityHash("tg", tgId)] : [])];
}

export type DeleteResult = { ok: true; forfeited: number } | { ok: false; reason: "not_found" | "admin" | "subscription" };

/**
 * Самостоятельное удаление аккаунта (право на удаление данных, 152-ФЗ). Всё, что идентифицирует человека, стирается:
 * почта, пароль, Telegram, имя, реферальный код, сессии, заметки, питчи, открытые заведения, эксклюзивы, отчёты для клиентов.
 * Остаются без привязки к человеку только платежи и проводки кредитов (учёт обязан храниться по закону) и необратимые хеши
 * идентификаторов (до года), чтобы повторной регистрацией нельзя было снова получить приветственные кредиты.
 * Кредиты, оставшиеся на балансе, сгорают. Пока идёт оплаченная подписка, удалить аккаунт нельзя: сначала возврат или окончание срока.
 */
export async function deleteAccount(userId: number): Promise<DeleteResult> {
  return writeTx<DeleteResult>(async (tx) => {
    const t = now();
    const u = (await tx.execute({ sql: "SELECT email, balance, tg_id, deleted_at FROM users WHERE id = ?", args: [userId] })).rows[0];
    if (!u || u.deleted_at != null) return { value: { ok: false, reason: "not_found" }, rollback: true };
    if (isAdminEmail(String(u.email))) return { value: { ok: false, reason: "admin" }, rollback: true };
    const active = Number((await tx.execute({ sql: "SELECT count(*) AS n FROM subscriptions WHERE user_id = ? AND ends_at > ?", args: [userId, t] })).rows[0].n);
    if (active > 0) return { value: { ok: false, reason: "subscription" }, rollback: true };

    for (const h of identityHashes(String(u.email), u.tg_id == null ? null : Number(u.tg_id))) {
      await tx.execute({ sql: "INSERT OR IGNORE INTO deleted_identities(hash, created_at) VALUES (?, ?)", args: [h, t] });
    }
    await tx.execute({ sql: "DELETE FROM deleted_identities WHERE created_at < ?", args: [t - YEAR] });

    for (const table of ["sessions", "password_resets", "lead_notes", "lead_pitches", "unlocks", "lead_claims", "audit_reports", "tg_login_requests"]) {
      await tx.execute({ sql: `DELETE FROM ${table} WHERE user_id = ?`, args: [userId] });
    }

    const forfeited = Number(u.balance);
    if (forfeited > 0) {
      await tx.execute({
        sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'account_deleted', NULL, ?)",
        args: [userId, -forfeited, t],
      });
    }
    await tx.execute({
      sql: `UPDATE users SET email = ?, pass_hash = '', balance = 0, tg_id = NULL, tg_username = NULL, display_name = NULL,
                   ref_code = NULL, referred_by = NULL, sub_next_at = NULL, deleted_at = ? WHERE id = ?`,
      args: [`deleted-${userId}@deleted.invalid`, t, userId],
    });
    return { value: { ok: true, forfeited } };
  });
}
