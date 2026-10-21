import { cookies } from "next/headers";
import { cache } from "react";
import { appDb } from "./db";
import { hashPassword, newToken, sha256, verifyPassword } from "./password";
import { syncSubscriptions } from "./subscriptions";
import { isTgEmail, type TgUser } from "./telegram";
import { createUser, loginOrCreateTelegramUser, type TelegramLogin } from "./users";

const COOKIE = "fw_session";
const SESSION_DAYS = 30;
const now = () => Math.floor(Date.now() / 1000);

/** label: как показывать человека: почта или, если входил через Telegram, @username и имя. */
export type User = { id: number; email: string; balance: number; label: string; tgLinked: boolean; tgUsername: string | null; hasPassword: boolean };

export function userLabel(email: string, tgUsername: string | null, displayName: string | null): string {
  if (!isTgEmail(email)) return email;
  return tgUsername ? `@${tgUsername}` : displayName || "Telegram";
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function validateCredentials(email: string, password: string): string | null {
  // Адреса .invalid зарезервированы под служебные почты входа через Telegram: занять такой вручную нельзя.
  if (!EMAIL_RE.test(email) || email.length > 254 || /\.invalid$/i.test(email)) return "Проверьте e-mail";
  if (password.length < 8) return "Пароль должен быть не короче 8 символов";
  if (password.length > 200) return "Пароль слишком длинный";
  return null;
}

export async function startSession(userId: number): Promise<void> {
  const db = await appDb();
  const { token, hash } = newToken();
  const t = now();
  await db.execute({
    sql: "INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    args: [hash, userId, t + SESSION_DAYS * 86400, t],
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function signUp(email: string, password: string, consentVersion?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const passHash = await hashPassword(password);
  const ref = (await cookies()).get("fw_ref")?.value ?? null;
  const r = await createUser(email, passHash, ref, consentVersion);
  if (!r.ok) return r;
  await startSession(r.userId);
  return { ok: true };
}

/** Вход или регистрация через Telegram. Данные виджета к этому моменту уже проверены (verifyTelegramLogin). */
export async function signInWithTelegram(
  tg: TgUser,
  opts: { consentVersion?: string | null; canCreate?: () => Promise<boolean> } = {},
): Promise<TelegramLogin> {
  const ref = (await cookies()).get("fw_ref")?.value ?? null;
  const r = await loginOrCreateTelegramUser(tg, { refCode: ref, ...opts });
  if (r.ok) await startSession(r.userId);
  return r;
}

// Хэш для несуществующего пользователя: чтобы время ответа не выдавало, есть ли такой e-mail.
const DUMMY = hashPassword("dummy-password-for-timing");

export async function logIn(email: string, password: string): Promise<boolean> {
  const db = await appDb();
  const r = await db.execute({ sql: "SELECT id, pass_hash FROM users WHERE email = ?", args: [email.trim().toLowerCase()] });
  const row = r.rows[0];
  const ok = await verifyPassword(password, row ? String(row.pass_hash) : await DUMMY);
  if (!row || !ok) return false;
  await startSession(Number(row.id));
  return true;
}

export async function logOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await appDb();
    await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [sha256(token)] });
  }
  jar.delete(COOKIE);
}

/** Текущий пользователь или null. Кэшируется на время одного запроса. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const db = await appDb();
    const r = await db.execute({
      sql: `SELECT u.id, u.email, u.balance, u.sub_next_at, u.tg_id, u.tg_username, u.display_name, u.pass_hash FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ?`,
      args: [sha256(token), now()],
    });
    const row = r.rows[0];
    if (!row) return null;
    let balance = Number(row.balance);
    // Подписке пришло время начислить очередной месяц: начисляем при заходе пользователя, отдельного планировщика нет.
    if (row.sub_next_at != null && Number(row.sub_next_at) <= now()) {
      balance += await syncSubscriptions(Number(row.id)).catch((e) => {
        console.error("[subscriptions] начисление не удалось", e);
        return 0;
      });
    }
    const email = String(row.email);
    return {
      id: Number(row.id), email, balance,
      tgLinked: row.tg_id != null, tgUsername: row.tg_username == null ? null : String(row.tg_username), hasPassword: String(row.pass_hash) !== "",
      label: userLabel(email, row.tg_username == null ? null : String(row.tg_username), row.display_name == null ? null : String(row.display_name)),
    };
  } catch {
    return null;
  }
});
