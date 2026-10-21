import { appDb, writeTx } from "./db";

export const UNLOCK_COST = 1;
export const SIGNUP_BONUS = Math.max(0, parseInt(process.env.SIGNUP_BONUS_CREDITS ?? "5", 10) || 0);

const now = () => Math.floor(Date.now() / 1000);

export type UnlockResult =
  | { ok: true; charged: number; balance: number }
  | { ok: false; reason: "insufficient"; balance: number };

/**
 * Открывает контакты лида за кредит. Повторное открытие бесплатно.
 * Всё в одной транзакции: либо списали, записали проводку и открытие, либо ничего не изменилось.
 */
export async function unlockLead(userId: number, leadId: string, cost = UNLOCK_COST): Promise<UnlockResult> {
  return writeTx<UnlockResult>(async (tx) => {
    const bal = async () =>
      Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] })).rows[0]?.balance ?? 0);

    const exists = await tx.execute({ sql: "SELECT 1 FROM unlocks WHERE user_id = ? AND lead_id = ?", args: [userId, leadId] });
    if (exists.rows.length) return { value: { ok: true, charged: 0, balance: await bal() } };

    const balance = await bal();
    if (balance < cost) return { value: { ok: false, reason: "insufficient", balance }, rollback: true };

    const t = now();
    await tx.execute({ sql: "UPDATE users SET balance = balance - ? WHERE id = ?", args: [cost, userId] });
    await tx.execute({ sql: "INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, ?, ?)", args: [userId, leadId, t] });
    await tx.execute({
      sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'unlock', ?, ?)",
      args: [userId, -cost, leadId, t],
    });
    return { value: { ok: true, charged: cost, balance: balance - cost } };
  });
}

export type UnlockManyResult =
  | { ok: true; opened: number; charged: number; balance: number }
  | { ok: false; reason: "insufficient"; need: number; balance: number };

/**
 * Открывает сразу несколько лидов за один раз: либо все новые, либо ни одного (если не хватает кредитов).
 * Уже открытые не списываются повторно.
 */
export async function unlockMany(userId: number, leadIds: string[], cost = UNLOCK_COST): Promise<UnlockManyResult> {
  const ids = [...new Set(leadIds)];
  return writeTx<UnlockManyResult>(async (tx) => {
    const have = new Set(
      ids.length
        ? (
            await tx.execute({
              sql: `SELECT lead_id FROM unlocks WHERE user_id = ? AND lead_id IN (${ids.map(() => "?").join(",")})`,
              args: [userId, ...ids],
            })
          ).rows.map((r) => String(r.lead_id))
        : [],
    );
    const fresh = ids.filter((i) => !have.has(i));
    const balance = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] })).rows[0]?.balance ?? 0);
    const total = fresh.length * cost;
    if (total > balance) return { value: { ok: false, reason: "insufficient", need: total, balance }, rollback: true };
    if (!fresh.length) return { value: { ok: true, opened: 0, charged: 0, balance } };

    const t = now();
    await tx.execute({ sql: "UPDATE users SET balance = balance - ? WHERE id = ?", args: [total, userId] });
    for (const id of fresh) {
      await tx.execute({ sql: "INSERT INTO unlocks(user_id, lead_id, created_at) VALUES (?, ?, ?)", args: [userId, id, t] });
      await tx.execute({
        sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'unlock', ?, ?)",
        args: [userId, -cost, id, t],
      });
    }
    return { value: { ok: true, opened: fresh.length, charged: total, balance: balance - total } };
  });
}

export async function grantCredits(userId: number, credits: number, reason: string, ref: string | null): Promise<void> {
  const db = await appDb();
  await db.batch(
    [
      { sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [credits, userId] },
      {
        sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [userId, credits, reason, ref, now()],
      },
    ],
    "write",
  );
}

export async function getBalance(userId: number): Promise<number> {
  const db = await appDb();
  const r = await db.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] });
  return Number(r.rows[0]?.balance ?? 0);
}

export async function isUnlocked(userId: number, leadId: string): Promise<boolean> {
  const db = await appDb();
  const r = await db.execute({ sql: "SELECT 1 FROM unlocks WHERE user_id = ? AND lead_id = ?", args: [userId, leadId] });
  return r.rows.length > 0;
}

export async function unlockedAmong(userId: number | null | undefined, ids: string[]): Promise<Set<string>> {
  if (!userId || ids.length === 0) return new Set();
  const db = await appDb();
  const r = await db.execute({
    sql: `SELECT lead_id FROM unlocks WHERE user_id = ? AND lead_id IN (${ids.map(() => "?").join(",")})`,
    args: [userId, ...ids],
  });
  return new Set(r.rows.map((x) => String(x.lead_id)));
}

export async function listUnlockedIds(userId: number, limit: number, offset = 0): Promise<string[]> {
  const db = await appDb();
  const r = await db.execute({
    sql: "SELECT lead_id FROM unlocks WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
    args: [userId, limit, offset],
  });
  return r.rows.map((x) => String(x.lead_id));
}

export async function countUnlocked(userId: number): Promise<number> {
  const db = await appDb();
  const r = await db.execute({ sql: "SELECT count(*) AS n FROM unlocks WHERE user_id = ?", args: [userId] });
  return Number(r.rows[0].n);
}

export type LedgerRow = { id: number; delta: number; reason: string; ref: string | null; createdAt: number };

export async function getLedger(userId: number, limit = 50): Promise<LedgerRow[]> {
  const db = await appDb();
  const r = await db.execute({
    sql: "SELECT id, delta, reason, ref, created_at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    args: [userId, limit],
  });
  return r.rows.map((x) => ({
    id: Number(x.id), delta: Number(x.delta), reason: String(x.reason), ref: x.ref == null ? null : String(x.ref),
    createdAt: Number(x.created_at),
  }));
}
