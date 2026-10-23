import type { Transaction } from "@libsql/client";
import { identityHash } from "./account-delete";
import { SIGNUP_BONUS } from "./credits";

const now = () => Math.floor(Date.now() / 1000);

/**
 * Приветственные кредиты: только за подтверждённый Telegram, один раз на Telegram-аккаунт и один раз на пользователя.
 * Почта на сайте не подтверждается, поэтому за регистрацию по почте бонус не даём: иначе его бесконечно получали бы
 * на выдуманные адреса. Telegram привязан к номеру телефона, такие аккаунты дорого плодить.
 * Не даём и тому, кто уже удалял аккаунт с этим Telegram (deleted_identities). Возвращает начисленное число кредитов.
 */
export async function grantTelegramBonus(tx: Transaction, userId: number, tgId: number): Promise<number> {
  if (SIGNUP_BONUS <= 0) return 0;
  const hash = identityHash("tg", tgId);
  const had = await tx.execute({ sql: "SELECT 1 FROM ledger WHERE user_id = ? AND reason = 'signup_bonus' LIMIT 1", args: [userId] });
  if (had.rows.length) return 0;
  const used = await tx.execute({
    sql: "SELECT 1 FROM bonus_claims WHERE hash = ? UNION ALL SELECT 1 FROM deleted_identities WHERE hash = ? LIMIT 1",
    args: [hash, hash],
  });
  if (used.rows.length) return 0;

  const t = now();
  await tx.execute({ sql: "INSERT INTO bonus_claims(hash, user_id, created_at) VALUES (?, ?, ?)", args: [hash, userId, t] });
  await tx.execute({ sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [SIGNUP_BONUS, userId] });
  await tx.execute({ sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'signup_bonus', NULL, ?)", args: [userId, SIGNUP_BONUS, t] });
  return SIGNUP_BONUS;
}

/** Может ли пользователь ещё получить бонус: не получал его и Telegram не привязан (иначе он уже выдан или недоступен). */
export async function bonusAvailable(db: { execute: Transaction["execute"] }, userId: number): Promise<boolean> {
  if (SIGNUP_BONUS <= 0) return false;
  const r = await db.execute({
    sql: "SELECT (SELECT tg_id FROM users WHERE id = ?) AS tg, EXISTS(SELECT 1 FROM ledger WHERE user_id = ? AND reason = 'signup_bonus') AS had",
    args: [userId, userId],
  });
  return r.rows[0]?.tg == null && Number(r.rows[0]?.had) === 0;
}
