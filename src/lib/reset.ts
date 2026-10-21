import { appDb, writeTx } from "./db";
import { emailConfigured, sendEmail } from "./email";
import { isTgEmail } from "./telegram";
import { hashPassword, newToken, sha256 } from "./password";

const TTL = 3600; // ссылка живёт час
const now = () => Math.floor(Date.now() / 1000);

export type RequestResult = { configured: boolean };

/**
 * Отправляет ссылку для сброса пароля, если такой пользователь есть. Снаружи не видно, есть ли он:
 * ответ один и тот же, иначе по форме можно было бы перебирать чужие адреса.
 */
export async function requestPasswordReset(email: string, baseUrl: string): Promise<RequestResult> {
  if (!emailConfigured()) return { configured: false };
  const mail = email.trim().toLowerCase();
  if (isTgEmail(mail)) return { configured: true }; // служебная почта входа через Telegram, писем туда не шлём
  const db = await appDb();
  const u = (await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [mail] })).rows[0];
  if (!u) return { configured: true };

  const { token, hash } = newToken();
  const t = now();
  // Старые неиспользованные ссылки гасим: действует только последняя.
  await db.batch(
    [
      { sql: "UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0", args: [Number(u.id)] },
      { sql: "INSERT INTO password_resets(token_hash, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)", args: [hash, Number(u.id), t + TTL, t] },
    ],
    "write",
  );

  const link = `${baseUrl}/reset?token=${token}`;
  await sendEmail({
    to: mail,
    subject: "Сброс пароля Лидомап",
    text: `Здравствуйте!\n\nВы (или кто-то другой) запросили сброс пароля в «Лидомапе». Чтобы задать новый пароль, откройте ссылку. Она действует 1 час:\n\n${link}\n\nЕсли вы ничего не запрашивали, просто проигнорируйте это письмо: пароль не изменится.`,
    html: `<p>Здравствуйте!</p><p>Вы (или кто-то другой) запросили сброс пароля в «Лидомапе». Чтобы задать новый пароль, откройте ссылку. Она действует 1 час:</p><p><a href="${link}">${link}</a></p><p>Если вы ничего не запрашивали, просто проигнорируйте это письмо: пароль не изменится.</p>`,
  });
  return { configured: true };
}

export type ResetResult = { ok: true; userId: number } | { ok: false; error: string };

/** Меняет пароль по ссылке. Ссылка одноразовая, а все прежние входы пользователя закрываются. */
export async function resetPassword(token: string, password: string): Promise<ResetResult> {
  if (password.length < 8) return { ok: false, error: "Пароль должен быть не короче 8 символов" };
  if (password.length > 200) return { ok: false, error: "Пароль слишком длинный" };
  const hash = sha256(token);
  const passHash = await hashPassword(password);

  return writeTx<ResetResult>(async (tx) => {
    const r = (await tx.execute({ sql: "SELECT user_id, expires_at, used FROM password_resets WHERE token_hash = ?", args: [hash] })).rows[0];
    if (!r || Number(r.used) === 1 || Number(r.expires_at) <= now()) {
      return { value: { ok: false, error: "Ссылка недействительна или устарела. Запросите новую." }, rollback: true };
    }
    const userId = Number(r.user_id);
    await tx.execute({ sql: "UPDATE users SET pass_hash = ? WHERE id = ?", args: [passHash, userId] });
    await tx.execute({ sql: "UPDATE password_resets SET used = 1 WHERE user_id = ?", args: [userId] });
    await tx.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] });
    return { value: { ok: true, userId } };
  });
}
