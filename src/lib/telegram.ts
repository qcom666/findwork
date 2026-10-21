import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Вход через Telegram Login Widget (https://core.telegram.org/widgets/login).
 * Включается двумя переменными: TELEGRAM_BOT_USERNAME (имя бота без @, не секрет) и TELEGRAM_BOT_TOKEN (секрет, только на сервере).
 * Бота создают в @BotFather, а командой /setdomain указывают домен сайта: на другом домене виджет не заработает.
 */
export function telegramBotUsername(): string | null {
  const v = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return v && /^[A-Za-z0-9_]{3,64}$/.test(v) ? v : null;
}

export function telegramConfigured(): boolean {
  return !!(telegramBotUsername() && process.env.TELEGRAM_BOT_TOKEN?.trim());
}

export type TgUser = { id: number; name: string | null; username: string | null };

export type TgVerify = { ok: true; user: TgUser } | { ok: false; reason: "format" | "signature" | "expired" };

/** Сколько секунд подпись Telegram считается свежей: виджет отдаёт данные сразу после нажатия, дольше держать незачем. */
const MAX_AGE = 600;
/** Допуск на разницу часов нашего сервера и Telegram. */
const SKEW = 300;

/**
 * Проверяет данные, которые виджет отдал странице: подпись HMAC-SHA256 по алгоритму из документации Telegram
 * (ключ: SHA-256 от токена бота; строка: все поля кроме hash, по алфавиту, «ключ=значение» через перевод строки) и свежесть auth_date.
 * Проверять нужно все пришедшие поля, а не известный нам набор: Telegram вправе добавить новые.
 */
export function verifyTelegramLogin(data: unknown, opts: { token?: string; nowSec?: number } = {}): TgVerify {
  const token = (opts.token ?? process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token || !data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "format" };

  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length > 16) return { ok: false, reason: "format" };
  const fields: Record<string, string> = {};
  for (const [k, v] of entries) {
    if ((typeof v !== "string" && typeof v !== "number") || String(v).length > 1024) return { ok: false, reason: "format" };
    fields[k] = String(v);
  }
  const hash = fields.hash;
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: "format" };

  const check = Object.keys(fields)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const expected = createHmac("sha256", createHash("sha256").update(token).digest()).update(check).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };

  const id = Number(fields.id);
  const authDate = Number(fields.auth_date);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(authDate)) return { ok: false, reason: "format" };
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (now - authDate > MAX_AGE || authDate - now > SKEW) return { ok: false, reason: "expired" };

  const name = [fields.first_name, fields.last_name].filter(Boolean).join(" ").trim().slice(0, 100) || null;
  const username = fields.username && /^[A-Za-z0-9_]{1,32}$/.test(fields.username) ? fields.username : null;
  return { ok: true, user: { id, name, username } };
}

/** Почта для аккаунтов без почты: домен .invalid зарезервирован стандартом и не может принадлежать никому. */
export const TG_EMAIL_SUFFIX = "@telegram.invalid";
export const tgEmail = (id: number) => `tg${id}${TG_EMAIL_SUFFIX}`;
export const isTgEmail = (email: string) => email.toLowerCase().endsWith(TG_EMAIL_SUFFIX);
