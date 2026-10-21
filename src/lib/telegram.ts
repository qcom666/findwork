/**
 * Вход через Telegram работает только через бота (tg-login.ts): человек нажимает Start и подтверждает вход в чате с ботом.
 * Нужны две переменные: TELEGRAM_BOT_USERNAME (имя бота без @, не секрет) и TELEGRAM_BOT_TOKEN (секрет, только на сервере).
 * Бота создают в @BotFather командой /newbot; вебхук сайт подключает сам.
 */
export function telegramBotUsername(): string | null {
  const v = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return v && /^[A-Za-z0-9_]{3,64}$/.test(v) ? v : null;
}

export function telegramConfigured(): boolean {
  return !!(telegramBotUsername() && process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export type TgUser = { id: number; name: string | null; username: string | null };

/** Почта для аккаунтов без почты: домен .invalid зарезервирован стандартом и не может принадлежать никому. */
export const TG_EMAIL_SUFFIX = "@telegram.invalid";
export const tgEmail = (id: number) => `tg${id}${TG_EMAIL_SUFFIX}`;
export const isTgEmail = (email: string) => email.toLowerCase().endsWith(TG_EMAIL_SUFFIX);
