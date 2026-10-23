import type { Transaction } from "@libsql/client";
import { grantTelegramBonus } from "./bonus";
import { appDb, writeTx } from "./db";
import { grantDue } from "./subscriptions";
import { isTgEmail, type TgUser } from "./telegram";

const now = () => Math.floor(Date.now() / 1000);

/** Что есть в аккаунте, который будет влит: показываем перед подтверждением и записываем в след объединения. */
export type MergeInfo = { balance: number; unlocks: number; payments: number; subscriptions: number; reports: number; claims: number };

async function count(tx: Transaction, sql: string, id: number): Promise<number> {
  return Number((await tx.execute({ sql, args: [id] })).rows[0].n);
}

async function infoOf(tx: Transaction, id: number): Promise<MergeInfo> {
  return {
    balance: Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [id] })).rows[0]?.balance ?? 0),
    unlocks: await count(tx, "SELECT count(*) AS n FROM unlocks WHERE user_id = ?", id),
    payments: await count(tx, "SELECT count(*) AS n FROM payments WHERE user_id = ? AND status = 'succeeded'", id),
    subscriptions: await count(tx, "SELECT count(*) AS n FROM subscriptions WHERE user_id = ?", id),
    reports: await count(tx, "SELECT count(*) AS n FROM audit_reports WHERE user_id = ?", id),
    claims: await count(tx, `SELECT count(*) AS n FROM lead_claims WHERE user_id = ? AND until > ${now()}`, id),
  };
}

/**
 * Вливает аккаунт source в target внутри транзакции: кредиты, история, открытые заведения, заметки, питчи, платежи,
 * подписки, эксклюзивы, отчёты, промокоды и приглашения переходят к target, а source перестаёт существовать.
 * При пересечении (одно заведение открыто в обоих, заметка к нему в обоих) остаётся запись target.
 * Telegram-поля source переходят к target.
 */
export async function mergeAccounts(tx: Transaction, sourceId: number, targetId: number): Promise<MergeInfo> {
  const t = now();
  const src = (await tx.execute({ sql: "SELECT email, balance, tg_id, tg_username, display_name, consent_at, consent_ver FROM users WHERE id = ?", args: [sourceId] })).rows[0];
  if (!src) throw new Error("аккаунт для объединения не найден");
  const info = await infoOf(tx, sourceId);
  const run = (sql: string, ...args: (string | number | null)[]) => tx.execute({ sql, args });

  // Таблицы с составным ключом: сначала переносим то, чего у target ещё нет, остальное удаляем.
  await run("INSERT OR IGNORE INTO unlocks(user_id, lead_id, created_at) SELECT ?, lead_id, created_at FROM unlocks WHERE user_id = ?", targetId, sourceId);
  await run("DELETE FROM unlocks WHERE user_id = ?", sourceId);
  await run("INSERT OR IGNORE INTO lead_notes(user_id, lead_id, status, note, updated_at) SELECT ?, lead_id, status, note, updated_at FROM lead_notes WHERE user_id = ?", targetId, sourceId);
  await run("DELETE FROM lead_notes WHERE user_id = ?", sourceId);
  await run(
    `INSERT OR IGNORE INTO lead_pitches(user_id, lead_id, service, channel, subject, message, followup, angle, source, created_at)
     SELECT ?, lead_id, service, channel, subject, message, followup, angle, source, created_at FROM lead_pitches WHERE user_id = ?`,
    targetId, sourceId,
  );
  await run("DELETE FROM lead_pitches WHERE user_id = ?", sourceId);
  await run("INSERT OR IGNORE INTO promo_redemptions(user_id, code, created_at) SELECT ?, code, created_at FROM promo_redemptions WHERE user_id = ?", targetId, sourceId);
  await run("DELETE FROM promo_redemptions WHERE user_id = ?", sourceId);

  // Таблицы, где строки просто меняют владельца.
  for (const table of ["ledger", "payments", "subscriptions", "lead_claims", "audit_reports"]) {
    await run(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`, targetId, sourceId);
  }

  // Приглашения: заслуги пригласившего переходят к target, а награда за самого source остаётся единственной.
  await run("UPDATE referral_rewards SET referrer_id = ? WHERE referrer_id = ?", targetId, sourceId);
  await run("UPDATE users SET referred_by = ? WHERE referred_by = ?", targetId, sourceId);
  const hasOwn = (await run("SELECT 1 FROM referral_rewards WHERE referred_id = ?", targetId)).rows.length > 0;
  if (hasOwn) await run("DELETE FROM referral_rewards WHERE referred_id = ?", sourceId);
  else await run("UPDATE referral_rewards SET referred_id = ? WHERE referred_id = ?", targetId, sourceId);

  await run("DELETE FROM sessions WHERE user_id = ?", sourceId);
  await run("DELETE FROM password_resets WHERE user_id = ?", sourceId);

  // Telegram переезжает: у source поля обнуляем первыми, иначе уникальный индекс не даст записать их target.
  await run("UPDATE users SET tg_id = NULL, tg_username = NULL, display_name = NULL WHERE id = ?", sourceId);
  await run(
    `UPDATE users SET balance = balance + ?, tg_id = ?, tg_username = ?, display_name = ?,
            consent_at = coalesce(consent_at, ?), consent_ver = coalesce(consent_ver, ?) WHERE id = ?`,
    Number(src.balance), src.tg_id == null ? null : Number(src.tg_id), src.tg_username == null ? null : String(src.tg_username),
    src.display_name == null ? null : String(src.display_name), src.consent_at == null ? null : Number(src.consent_at),
    src.consent_ver == null ? null : String(src.consent_ver), targetId,
  );
  await run(
    "INSERT INTO account_merges(source_id, target_id, source_email, summary, created_at) VALUES (?, ?, ?, ?, ?)",
    sourceId, targetId, String(src.email), JSON.stringify(info), t,
  );
  await run("DELETE FROM users WHERE id = ?", sourceId);

  // Подписки двух аккаунтов теперь у одного: пересчитываем график начислений и начисляем то, что уже наступило.
  await grantDue(tx, targetId, t);
  return info;
}

export type LinkResult =
  | { ok: true; merged: boolean; /** приветственные кредиты за привязку Telegram, если их ещё не давали */ bonus: number }
  | { ok: false; reason: "no_user" | "synthetic" | "already" | "other_tg" | "taken" }
  | { ok: false; reason: "needConfirm"; info: MergeInfo };

/**
 * Привязывает Telegram к аккаунту с почтой. Если этот Telegram уже заходил на сайт отдельно и у него свой аккаунт (только Telegram),
 * аккаунты объединяются, но только после подтверждения (confirm): сначала возвращаем, что именно будет перенесено.
 */
export async function linkTelegram(userId: number, tg: TgUser, opts: { confirm?: boolean } = {}): Promise<LinkResult> {
  return writeTx<LinkResult>(async (tx) => {
    const me = (await tx.execute({ sql: "SELECT email, tg_id FROM users WHERE id = ?", args: [userId] })).rows[0];
    if (!me) return { value: { ok: false, reason: "no_user" }, rollback: true };
    if (isTgEmail(String(me.email))) return { value: { ok: false, reason: "synthetic" }, rollback: true };
    if (me.tg_id != null) {
      return { value: { ok: false, reason: Number(me.tg_id) === tg.id ? "already" : "other_tg" }, rollback: true };
    }

    const other = (await tx.execute({ sql: "SELECT id, email FROM users WHERE tg_id = ?", args: [tg.id] })).rows[0];
    // Этот Telegram уже привязан к другому аккаунту с настоящей почтой. Вливать его нельзя: пропала бы чужая почта и пароль,
    // а доказательство у нас только одно, владение Telegram. Пусть сначала отвяжет Telegram там, войдя по почте.
    if (other && !isTgEmail(String(other.email))) return { value: { ok: false, reason: "taken" }, rollback: true };
    if (!other) {
      await tx.execute({ sql: "UPDATE users SET tg_id = ?, tg_username = ?, display_name = ? WHERE id = ?", args: [tg.id, tg.username, tg.name, userId] });
      return { value: { ok: true, merged: false, bonus: await grantTelegramBonus(tx, userId, tg.id) } };
    }

    if (!opts.confirm) return { value: { ok: false, reason: "needConfirm", info: await infoOf(tx, Number(other.id)) }, rollback: true };
    await mergeAccounts(tx, Number(other.id), userId);
    await tx.execute({ sql: "UPDATE users SET tg_username = ?, display_name = ? WHERE id = ?", args: [tg.username, tg.name, userId] });
    return { value: { ok: true, merged: true, bonus: await grantTelegramBonus(tx, userId, tg.id) } };
  });
}

/** Отвязывает Telegram. Только у аккаунта с настоящей почтой и паролем: иначе человек потеряет единственный способ входа. */
export async function unlinkTelegram(userId: number): Promise<{ ok: true } | { ok: false; reason: "no_password" | "not_linked" }> {
  const db = await appDb();
  const me = (await db.execute({ sql: "SELECT email, pass_hash, tg_id FROM users WHERE id = ?", args: [userId] })).rows[0];
  if (!me || me.tg_id == null) return { ok: false, reason: "not_linked" };
  if (isTgEmail(String(me.email)) || !String(me.pass_hash)) return { ok: false, reason: "no_password" };
  await db.execute({ sql: "UPDATE users SET tg_id = NULL, tg_username = NULL, display_name = NULL WHERE id = ?", args: [userId] });
  return { ok: true };
}

/** Что сказать человеку, когда привязка не удалась. Текст для входа и привязки через бота. */
export function linkMessage(reason: Exclude<LinkResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "already": return "Этот Telegram уже привязан к вашему аккаунту";
    case "other_tg": return "К вашему аккаунту уже привязан другой Telegram. Сначала отвяжите его.";
    case "taken": return "Этот Telegram привязан к другому аккаунту с почтой. Войдите в него и отвяжите Telegram там, затем повторите.";
    case "synthetic": return "Этот аккаунт уже работает через Telegram";
    case "needConfirm": return "Нужно подтвердить объединение аккаунтов";
    default: return "Аккаунт не найден";
  }
}
