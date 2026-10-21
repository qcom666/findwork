import type { Client, Transaction } from "@libsql/client";
import { appDb } from "./db";
import { BASE_PERKS, PLANS, type Perks } from "./plans";

export type Entitlements = Perks & { planId: string | null; planTitle: string | null };

const now = () => Math.floor(Date.now() / 1000);

/** Права без подписки. Лимит питчей в час по умолчанию можно поднять или опустить переменной PITCH_HOURLY_LIMIT. */
export function baseEntitlements(): Entitlements {
  const env = parseInt(process.env.PITCH_HOURLY_LIMIT ?? "", 10);
  return { ...BASE_PERKS, pitchesPerHour: env > 0 ? env : BASE_PERKS.pitchesPerHour, planId: null, planTitle: null };
}

/**
 * Права пользователя на момент t: по действующей подписке (начавшейся и не закончившейся). Подписки идут одна за другой,
 * поэтому действующая обычно одна; если их несколько, берётся старший тариф. Подписка, которая ещё не началась, прав не даёт.
 * Питчи в час не бывают ниже базового лимита: подписка может только добавлять.
 */
export async function entitlementsAt(db: Client | Transaction, userId: number, t = now()): Promise<Entitlements> {
  const rows = (
    await db.execute({ sql: "SELECT plan_id FROM subscriptions WHERE user_id = ? AND starts_at <= ? AND ends_at > ?", args: [userId, t, t] })
  ).rows.map((r) => String(r.plan_id));
  const base = baseEntitlements();
  const best = PLANS.map((p, i) => ({ p, i })).filter(({ p }) => rows.includes(p.id)).sort((a, b) => b.i - a.i)[0]?.p;
  if (!best) return base;
  return { ...best.perks, pitchesPerHour: Math.max(best.perks.pitchesPerHour, base.pitchesPerHour), planId: best.id, planTitle: best.title };
}

export async function getEntitlements(userId: number): Promise<Entitlements> {
  return entitlementsAt(await appDb(), userId);
}
