import { createHash } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { appDb, writeTx } from "./db";
import { TRIAL, addMonths, getPlan } from "./plans";

const now = () => Math.floor(Date.now() / 1000);

type SubRow = { id: number; months: number; cpm: number; startsAt: number; granted: number };

/**
 * Начисляет кредиты за все месяцы, срок которых уже наступил, и пересчитывает users.sub_next_at.
 * Вызывается внутри транзакции записи: параллельные вызовы выстраиваются в очередь, а условие granted = ? не даёт начислить месяц дважды.
 * Возвращает, сколько кредитов начислено.
 */
export async function grantDue(tx: Transaction, userId: number, t = now()): Promise<number> {
  const subs = (
    await tx.execute({
      sql: "SELECT id, months, credits_per_month, starts_at, granted FROM subscriptions WHERE user_id = ? AND granted < months ORDER BY starts_at, id",
      args: [userId],
    })
  ).rows.map((r): SubRow => ({ id: Number(r.id), months: Number(r.months), cpm: Number(r.credits_per_month), startsAt: Number(r.starts_at), granted: Number(r.granted) }));

  let total = 0;
  let next: number | null = null;
  for (const s of subs) {
    let k = s.granted;
    while (k < s.months && addMonths(s.startsAt, k) <= t) {
      await tx.execute({
        sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'subscription', ?, ?)",
        args: [userId, s.cpm, `${s.id}:${k + 1}`, t],
      });
      total += s.cpm;
      k++;
    }
    if (k !== s.granted) {
      const upd = await tx.execute({ sql: "UPDATE subscriptions SET granted = ? WHERE id = ? AND granted = ?", args: [k, s.id, s.granted] });
      if (upd.rowsAffected !== 1) throw new Error("подписка изменилась во время начисления");
    }
    if (k < s.months) {
      const at = addMonths(s.startsAt, k);
      next = next === null ? at : Math.min(next, at);
    }
  }
  if (total > 0) await tx.execute({ sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [total, userId] });
  await tx.execute({ sql: "UPDATE users SET sub_next_at = ? WHERE id = ?", args: [next, userId] });
  return total;
}

/**
 * Заводит подписку после успешной оплаты (внутри транзакции fulfillPayment) и сразу начисляет первый месяц.
 * Если у пользователя уже есть действующая подписка, новая начнётся после её окончания: оплаченное время не теряется.
 */
export async function startSubscription(
  tx: Transaction,
  p: { userId: number; paymentId: string; planId: string; months: number; creditsTotal: number },
  t: number,
): Promise<void> {
  const last = Number((await tx.execute({ sql: "SELECT max(ends_at) AS e FROM subscriptions WHERE user_id = ?", args: [p.userId] })).rows[0]?.e ?? 0);
  const startsAt = Math.max(t, last);
  await tx.execute({
    sql: `INSERT INTO subscriptions(user_id, payment_id, plan_id, months, credits_per_month, starts_at, ends_at, granted, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    args: [p.userId, p.paymentId, p.planId, p.months, p.creditsTotal / p.months, startsAt, addMonths(startsAt, p.months), t],
  });
  await grantDue(tx, p.userId, t);
}

export type SavedMethod = { id: string; title: string; saved: boolean };

const trialHashes = (userId: number, tgId: number | null) =>
  [`trial:user:${userId}`, ...(tgId != null ? [`trial:tg:${tgId}`] : [])].map((s) => createHash("sha256").update(s).digest("hex"));

/** Брал ли человек пробную неделю раньше: с этого аккаунта или с этим Telegram на другом аккаунте. */
export async function trialUsed(db: Client | Transaction, userId: number, tgId: number | null): Promise<boolean> {
  const h = trialHashes(userId, tgId);
  return (await db.execute({ sql: `SELECT 1 FROM trial_claims WHERE hash IN (${h.map(() => "?").join(",")}) LIMIT 1`, args: h })).rows.length > 0;
}

/**
 * Пробная неделя после оплаты (внутри транзакции fulfillPayment): подписка на TRIAL.days дней с кредитами пробного срока сразу,
 * отметка «пробная взята» и включение автопродления, если ЮKassa сохранила карту. Не сохранила — неделя всё равно начинается,
 * а автопродление выключается: списывать будет не с чего.
 */
export async function activateTrial(tx: Transaction, p: { userId: number; paymentId: string; credits: number }, t: number, method: SavedMethod | null): Promise<void> {
  const u = (await tx.execute({ sql: "SELECT tg_id FROM users WHERE id = ?", args: [p.userId] })).rows[0];
  const tgId = u?.tg_id == null ? null : Number(u.tg_id);
  if (await trialUsed(tx, p.userId, tgId)) {
    // Пробную оплатили второй раз (две вкладки, две оплаты): вторую неделю не даём, 1 ₽ возвращается по запросу (раздел 16 оферты)
    await tx.execute({
      sql: "UPDATE autorenewals SET status = 'canceled', canceled_at = ?, cancel_reason = 'duplicate' WHERE trial_payment_id = ? AND status = 'pending'",
      args: [t, p.paymentId],
    });
    console.error(`[subscriptions] повторная оплата пробной недели ${p.paymentId}, пользователь ${p.userId}`);
    return;
  }
  for (const h of trialHashes(p.userId, tgId)) {
    await tx.execute({ sql: "INSERT OR IGNORE INTO trial_claims(hash, user_id, created_at) VALUES (?, ?, ?)", args: [h, p.userId, t] });
  }
  const last = Number((await tx.execute({ sql: "SELECT max(ends_at) AS e FROM subscriptions WHERE user_id = ?", args: [p.userId] })).rows[0]?.e ?? 0);
  const startsAt = Math.max(t, last);
  const endsAt = startsAt + TRIAL.days * 86400;
  await tx.execute({
    sql: `INSERT INTO subscriptions(user_id, payment_id, plan_id, months, credits_per_month, starts_at, ends_at, granted, created_at, trial)
          VALUES (?, ?, ?, 1, ?, ?, ?, 0, ?, 1)`,
    args: [p.userId, p.paymentId, TRIAL.planId, p.credits, startsAt, endsAt, t],
  });
  await grantDue(tx, p.userId, t);
  if (method?.saved) {
    await tx.execute({
      sql: "UPDATE autorenewals SET status = 'active', method_id = ?, method_title = ?, next_charge_at = ? WHERE trial_payment_id = ? AND status = 'pending'",
      args: [method.id, method.title, endsAt, p.paymentId],
    });
  } else {
    await tx.execute({
      sql: "UPDATE autorenewals SET status = 'canceled', canceled_at = ?, cancel_reason = 'not_saved' WHERE trial_payment_id = ? AND status = 'pending'",
      args: [t, p.paymentId],
    });
  }
}

/** Начисляет то, что подписке пора начислить. Дёшево вызывать часто: без записи, если ничего не наступило. */
export async function syncSubscriptions(userId: number): Promise<number> {
  return writeTx<number>(async (tx) => ({ value: await grantDue(tx, userId) }));
}

export type SubscriptionInfo = {
  planId: string;
  title: string;
  months: number;
  creditsPerMonth: number;
  startsAt: number;
  endsAt: number;
  granted: number;
  /** Когда придут следующие кредиты; null, если все месяцы уже начислены. */
  nextGrantAt: number | null;
  /** Пробная неделя: срок в днях, кредиты пришли сразу */
  trial: boolean;
};

function toInfo(r: Record<string, unknown>): SubscriptionInfo {
  const months = Number(r.months), granted = Number(r.granted), startsAt = Number(r.starts_at);
  return {
    trial: Number(r.trial ?? 0) === 1,
    planId: String(r.plan_id),
    title: getPlan(String(r.plan_id))?.title ?? String(r.plan_id),
    months,
    creditsPerMonth: Number(r.credits_per_month),
    startsAt,
    endsAt: Number(r.ends_at),
    granted,
    nextGrantAt: granted < months ? addMonths(startsAt, granted) : null,
  };
}

/** Действующая подписка и очередь оплаченных после неё. Закончившиеся подписки не возвращаются. */
export async function getSubscriptions(userId: number): Promise<SubscriptionInfo[]> {
  const db = await appDb();
  const rs = await db.execute({ sql: "SELECT * FROM subscriptions WHERE user_id = ? AND ends_at > ? ORDER BY starts_at, id", args: [userId, now()] });
  return rs.rows.map((r) => toInfo(r as unknown as Record<string, unknown>));
}

export async function getSubscriptionByPayment(userId: number, paymentId: string): Promise<SubscriptionInfo | null> {
  const db = await appDb();
  const r = (await db.execute({ sql: "SELECT * FROM subscriptions WHERE user_id = ? AND payment_id = ?", args: [userId, paymentId] })).rows[0];
  return r ? toInfo(r as unknown as Record<string, unknown>) : null;
}
