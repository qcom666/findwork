import { randomBytes } from "node:crypto";
import { appDb, writeTx } from "./db";

const now = () => Math.floor(Date.now() / 1000);
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

/** Код вводят руками: пробелы по краям и регистр не должны мешать. */
export function normalizeCode(raw: string): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export type RedeemResult =
  | { ok: true; credits: number; balance: number }
  | { ok: false; reason: "invalid" | "expired" | "exhausted" | "already" };

export const REDEEM_MESSAGE: Record<string, string> = {
  invalid: "Такого промокода нет",
  expired: "Срок действия промокода закончился",
  exhausted: "Промокод уже использован максимальное число раз",
  already: "Вы уже использовали этот промокод",
};

/** Начисляет кредиты по промокоду. Один человек может использовать код один раз, всё в одной транзакции. */
export async function redeemPromo(userId: number, raw: string): Promise<RedeemResult> {
  const code = normalizeCode(raw);
  if (!CODE_RE.test(code)) return { ok: false, reason: "invalid" };

  return writeTx<RedeemResult>(async (tx) => {
    const p = (await tx.execute({ sql: "SELECT credits, max_uses, used, expires_at FROM promo_codes WHERE code = ?", args: [code] })).rows[0];
    const fail = (reason: "invalid" | "expired" | "exhausted" | "already") => ({ value: { ok: false, reason } as RedeemResult, rollback: true });
    if (!p) return fail("invalid");
    if (p.expires_at != null && Number(p.expires_at) <= now()) return fail("expired");
    if (p.max_uses != null && Number(p.used) >= Number(p.max_uses)) return fail("exhausted");
    const dup = await tx.execute({ sql: "SELECT 1 FROM promo_redemptions WHERE user_id = ? AND code = ?", args: [userId, code] });
    if (dup.rows.length) return fail("already");

    const credits = Number(p.credits);
    const t = now();
    await tx.execute({ sql: "INSERT INTO promo_redemptions(user_id, code, created_at) VALUES (?, ?, ?)", args: [userId, code, t] });
    await tx.execute({ sql: "UPDATE promo_codes SET used = used + 1 WHERE code = ?", args: [code] });
    await tx.execute({ sql: "UPDATE users SET balance = balance + ? WHERE id = ?", args: [credits, userId] });
    await tx.execute({ sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'promo', ?, ?)", args: [userId, credits, code, t] });
    const balance = Number((await tx.execute({ sql: "SELECT balance FROM users WHERE id = ?", args: [userId] })).rows[0].balance);
    return { value: { ok: true, credits, balance } };
  });
}

// Без похожих символов (0/O, 1/I), чтобы код не путали при диктовке.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode(): string {
  const bytes = randomBytes(8);
  return "FW-" + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export type PromoInput = { code?: string; credits: number; maxUses?: number | null; days?: number | null; note?: string };

/** Создаёт промокод (для владельца). Пустой код заменяется случайным. */
export async function createPromo(input: PromoInput): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const credits = Math.floor(Number(input.credits));
  if (!Number.isFinite(credits) || credits < 1 || credits > 1000) return { ok: false, error: "Кредитов должно быть от 1 до 1000" };
  const maxUses = input.maxUses == null ? null : Math.floor(Number(input.maxUses));
  if (maxUses !== null && (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 100000)) return { ok: false, error: "Число использований от 1 до 100 000" };
  const days = input.days == null ? null : Math.floor(Number(input.days));
  if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) return { ok: false, error: "Срок действия от 1 до 3650 дней" };

  const code = input.code?.trim() ? normalizeCode(input.code) : randomCode();
  if (!CODE_RE.test(code)) return { ok: false, error: "Код: 3–32 символа, латинские буквы, цифры, дефис и подчёркивание" };

  const db = await appDb();
  try {
    await db.execute({
      sql: "INSERT INTO promo_codes(code, credits, max_uses, used, expires_at, note, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)",
      args: [code, credits, maxUses, days === null ? null : now() + days * 86400, (input.note ?? "").slice(0, 200), now()],
    });
  } catch (e) {
    if (/UNIQUE|constraint/i.test((e as Error).message)) return { ok: false, error: "Такой код уже есть" };
    throw e;
  }
  return { ok: true, code };
}

export type PromoRow = { code: string; credits: number; maxUses: number | null; used: number; expiresAt: number | null; note: string; createdAt: number };

export async function listPromos(limit = 50): Promise<PromoRow[]> {
  const db = await appDb();
  const r = await db.execute({ sql: "SELECT code, credits, max_uses, used, expires_at, note, created_at FROM promo_codes ORDER BY created_at DESC, rowid DESC LIMIT ?", args: [limit] });
  return r.rows.map((x) => ({
    code: String(x.code), credits: Number(x.credits), maxUses: x.max_uses == null ? null : Number(x.max_uses), used: Number(x.used),
    expiresAt: x.expires_at == null ? null : Number(x.expires_at), note: String(x.note), createdAt: Number(x.created_at),
  }));
}
