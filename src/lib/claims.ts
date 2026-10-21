import type { Client, Transaction } from "@libsql/client";
import { appDb, writeTx } from "./db";
import { entitlementsAt } from "./entitlements";
import { EXCLUSIVE_COST, EXCLUSIVE_DAYS } from "./plans";

const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

/**
 * Эксклюзив на заведение: пока он действует, его не могут открыть другие пользователи. Те, кто открыл заведение раньше, доступа
 * не теряют. Взять эксклюзив можно только по действующей подписке, на ограниченное тарифом число заведений сразу, за EXCLUSIVE_COST кредитов.
 */

/** Чужие действующие эксклюзивы среди заведений: id заведения и до какого момента закрыто. Свои не мешают, userId пустой у гостя. */
export async function claimedByOthers(db: Client | Transaction, userId: number | undefined, leadIds: string[], t = now()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!leadIds.length) return out;
  const rs = await db.execute({
    sql: `SELECT lead_id, until FROM lead_claims WHERE until > ? AND user_id != ? AND lead_id IN (${leadIds.map(() => "?").join(",")})`,
    args: [t, userId ?? 0, ...leadIds],
  });
  for (const r of rs.rows) out.set(String(r.lead_id), Number(r.until));
  return out;
}

export type ClaimResult =
  | { ok: true; until: number; balance: number }
  | { ok: false; reason: "no_plan" }
  | { ok: false; reason: "not_opened" }
  | { ok: false; reason: "mine"; until: number }
  | { ok: false; reason: "taken"; until: number }
  | { ok: false; reason: "no_slots"; slots: number }
  | { ok: false; reason: "insufficient"; balance: number };

export async function claimLead(userId: number, leadId: string): Promise<ClaimResult> {
  return writeTx<ClaimResult>(async (tx) => {
    const t = now();
    const fail = (value: ClaimResult) => ({ value, rollback: true as const });

    const ent = await entitlementsAt(tx, userId, t);
    if (!ent.planId || ent.exclusiveSlots <= 0) return fail({ ok: false, reason: "no_plan" });

    const opened = await tx.execute({ sql: "SELECT 1 FROM unlocks WHERE user_id = ? AND lead_id = ?", args: [userId, leadId] });
    if (!opened.rows.length) return fail({ ok: false, reason: "not_opened" });

    const cur = (await tx.execute({ sql: "SELECT user_id, until FROM lead_claims WHERE lead_id = ?", args: [leadId] })).rows[0];
    if (cur && Number(cur.until) > t) {
      return fail(Number(cur.user_id) === userId ? { ok: false, reason: "mine", until: Number(cur.until) } : { ok: false, reason: "taken", until: Number(cur.until) });
    }

    const used = Number((await tx.execute({ sql: "SELECT count(*) AS n FROM lead_claims WHERE user_id = ? AND until > ?", args: [userId, t] })).rows[0].n);
    if (used >= ent.exclusiveSlots) return fail({ ok: false, reason: "no_slots", slots: ent.exclusiveSlots });

    const balance = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] })).rows[0]?.balance ?? 0);
    if (balance < EXCLUSIVE_COST) return fail({ ok: false, reason: "insufficient", balance });

    const until = t + EXCLUSIVE_DAYS * DAY;
    await tx.execute({ sql: "UPDATE users SET balance = balance - ? WHERE id = ?", args: [EXCLUSIVE_COST, userId] });
    await tx.execute({
      sql: `INSERT INTO lead_claims(lead_id, user_id, created_at, until) VALUES (?, ?, ?, ?)
            ON CONFLICT(lead_id) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at, until = excluded.until`,
      args: [leadId, userId, t, until],
    });
    await tx.execute({
      sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'exclusive', ?, ?)",
      args: [userId, -EXCLUSIVE_COST, leadId, t],
    });
    return { value: { ok: true, until, balance: balance - EXCLUSIVE_COST } };
  });
}

/** Отпустить эксклюзив раньше срока: слот освобождается, кредиты не возвращаются. */
export async function releaseClaim(userId: number, leadId: string): Promise<boolean> {
  const db = await appDb();
  const r = await db.execute({ sql: "DELETE FROM lead_claims WHERE lead_id = ? AND user_id = ? AND until > ?", args: [leadId, userId, now()] });
  return r.rowsAffected === 1;
}

export type ClaimInfo = {
  /** Эксклюзив этого пользователя на заведение: до какого момента. */
  mine: number | null;
  /** Другой пользователь держит эксклюзив до этого момента (новые пользователи открыть заведение не могут). */
  other: number | null;
  /** Сколько других пользователей уже открыли контакты этого заведения. */
  othersOpened: number;
};

export async function getClaimInfo(userId: number, leadId: string): Promise<ClaimInfo> {
  const db = await appDb();
  const t = now();
  const [c, o] = await Promise.all([
    db.execute({ sql: "SELECT user_id, until FROM lead_claims WHERE lead_id = ? AND until > ?", args: [leadId, t] }),
    db.execute({ sql: "SELECT count(*) AS n FROM unlocks WHERE lead_id = ? AND user_id != ?", args: [leadId, userId] }),
  ]);
  const row = c.rows[0];
  return {
    mine: row && Number(row.user_id) === userId ? Number(row.until) : null,
    other: row && Number(row.user_id) !== userId ? Number(row.until) : null,
    othersOpened: Number(o.rows[0].n),
  };
}

/** Сколько эксклюзивов сейчас занято у пользователя. */
export async function activeClaimCount(userId: number): Promise<number> {
  const db = await appDb();
  return Number((await db.execute({ sql: "SELECT count(*) AS n FROM lead_claims WHERE user_id = ? AND until > ?", args: [userId, now()] })).rows[0].n);
}
