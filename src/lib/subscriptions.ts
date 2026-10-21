import type { Transaction } from "@libsql/client";
import { appDb, writeTx } from "./db";
import { addMonths, getPlan } from "./plans";

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
};

function toInfo(r: Record<string, unknown>): SubscriptionInfo {
  const months = Number(r.months), granted = Number(r.granted), startsAt = Number(r.starts_at);
  return {
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
