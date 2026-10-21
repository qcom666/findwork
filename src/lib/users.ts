import { randomBytes } from "node:crypto";
import { SIGNUP_BONUS } from "./credits";
import { appDb, writeTx } from "./db";
import { tgEmail, type TgUser } from "./telegram";

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
 * consentVersion: редакция документов, которую принял пользователь (сохраняем вместе со временем согласия).
 * tg: вход через Telegram; тогда пароля нет (passHash пустой, войти по паролю нельзя), а почта служебная.
 */
export async function createUser(email: string, passHash: string, refCode?: string | null, consentVersion?: string, tg?: TgUser): Promise<CreateResult> {
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
          sql: `INSERT INTO users(email, pass_hash, balance, created_at, ref_code, referred_by, consent_at, consent_ver, tg_id, tg_username, display_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [mail, passHash, SIGNUP_BONUS, t, mine, referrer, consentVersion ? t : null, consentVersion ?? null, tg?.id ?? null, tg?.username ?? null, tg?.name ?? null],
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

export type TelegramLogin =
  | { ok: true; userId: number; created: boolean }
  | { ok: false; needConsent: true }
  | { ok: false; needConsent?: false; error: string };

/**
 * Находит аккаунт по Telegram или создаёт новый. Новый создаётся только с согласием на оферту и обработку данных
 * (consentVersion): без него возвращается needConsent, и страница спрашивает согласие отдельным действием.
 * canCreate: проверка лимита на создание аккаунтов, вызывается только когда аккаунт действительно будет создан.
 */
export async function loginOrCreateTelegramUser(
  tg: TgUser,
  opts: { refCode?: string | null; consentVersion?: string | null; canCreate?: () => Promise<boolean> } = {},
): Promise<TelegramLogin> {
  const db = await appDb();
  const find = async () => (await db.execute({ sql: "SELECT id FROM users WHERE tg_id = ?", args: [tg.id] })).rows[0];

  const found = await find();
  if (found) return { ok: true, userId: await touchTelegramUser(Number(found.id), tg), created: false };

  if (!opts.consentVersion) return { ok: false, needConsent: true };
  if (opts.canCreate && !(await opts.canCreate())) return { ok: false, error: "Слишком много регистраций с вашего адреса. Попробуйте позже." };

  const r = await createUser(tgEmail(tg.id), "", opts.refCode, opts.consentVersion, tg);
  if (r.ok) return { ok: true, userId: r.userId, created: true };
  // Два первых входа одновременно: второй упёрся в уже созданный аккаунт, это не ошибка.
  const again = await find();
  return again ? { ok: true, userId: await touchTelegramUser(Number(again.id), tg), created: false } : { ok: false, error: r.error };
}

/** Обновляет имя и username из Telegram: человек мог их сменить. */
async function touchTelegramUser(userId: number, tg: TgUser): Promise<number> {
  const db = await appDb();
  await db.execute({ sql: "UPDATE users SET tg_username = ?, display_name = ? WHERE id = ?", args: [tg.username, tg.name, userId] });
  return userId;
}
