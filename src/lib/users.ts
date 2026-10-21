import { randomBytes } from "node:crypto";
import { SIGNUP_BONUS } from "./credits";
import { appDb, writeTx } from "./db";

const now = () => Math.floor(Date.now() / 1000);
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const REF_RE = /^[a-z0-9]{6,16}$/;

export function newRefCode(): string {
  return [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

export type CreateResult = { ok: true; userId: number } | { ok: false; error: string };

/**
 * Создаёт пользователя с бонусом за регистрацию и своим реферальным кодом.
 * refCode: код пригласившего. Неизвестный код и свой собственный молча игнорируются.
 */
export async function createUser(email: string, passHash: string, refCode?: string | null): Promise<CreateResult> {
  const mail = email.trim().toLowerCase();
  const t = now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const mine = newRefCode();
    try {
      const out = await writeTx<CreateResult>(async (tx) => {
        const dup = await tx.execute({ sql: "SELECT 1 FROM users WHERE email = ?", args: [mail] });
        if (dup.rows.length) return { value: { ok: false, error: "Этот e-mail уже зарегистрирован" }, rollback: true };

        let referrer: number | null = null;
        if (refCode && REF_RE.test(refCode)) {
          const r = (await tx.execute({ sql: "SELECT id FROM users WHERE ref_code = ?", args: [refCode] })).rows[0];
          if (r) referrer = Number(r.id);
        }
        const ins = await tx.execute({
          sql: "INSERT INTO users(email, pass_hash, balance, created_at, ref_code, referred_by) VALUES (?, ?, ?, ?, ?, ?)",
          args: [mail, passHash, SIGNUP_BONUS, t, mine, referrer],
        });
        const userId = Number(ins.lastInsertRowid);
        if (SIGNUP_BONUS > 0) {
          await tx.execute({ sql: "INSERT INTO ledger(user_id, delta, reason, ref, created_at) VALUES (?, ?, 'signup_bonus', NULL, ?)", args: [userId, SIGNUP_BONUS, t] });
        }
        return { value: { ok: true, userId } };
      });
      return out;
    } catch (e) {
      // Совпал случайный реферальный код: пробуем другой. Любая иная ошибка — наружу.
      if (!/ref_code|ux_users_ref/i.test((e as Error).message)) throw e;
    }
  }
  throw new Error("Не удалось подобрать реферальный код");
}

export type ReferralInfo = { code: string; invited: number; paid: number; earned: number };

/** Ссылка-приглашение и статистика. У старых аккаунтов код создаётся при первом обращении. */
export async function getReferralInfo(userId: number): Promise<ReferralInfo> {
  const db = await appDb();
  let code = String((await db.execute({ sql: "SELECT ref_code FROM users WHERE id = ?", args: [userId] })).rows[0]?.ref_code ?? "");
  for (let i = 0; !code && i < 5; i++) {
    const c = newRefCode();
    try {
      await db.execute({ sql: "UPDATE users SET ref_code = ? WHERE id = ? AND ref_code IS NULL", args: [c, userId] });
    } catch {
      continue;
    }
    code = String((await db.execute({ sql: "SELECT ref_code FROM users WHERE id = ?", args: [userId] })).rows[0]?.ref_code ?? "");
  }
  const [inv, paid] = await Promise.all([
    db.execute({ sql: "SELECT count(*) AS n FROM users WHERE referred_by = ?", args: [userId] }),
    db.execute({ sql: "SELECT count(*) AS n, coalesce(sum(credits), 0) AS c FROM referral_rewards WHERE referrer_id = ?", args: [userId] }),
  ]);
  return { code, invited: Number(inv.rows[0].n), paid: Number(paid.rows[0].n), earned: Number(paid.rows[0].c) };
}
