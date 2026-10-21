import { createHash, timingSafeEqual } from "node:crypto";
import { telegramBotUsername } from "./telegram";

/**
 * Клиент Bot API и проверка вебхука. Токен бота лежит только в окружении сервера и никуда не отдаётся.
 * TELEGRAM_API_URL нужен тестам: они подставляют поддельный сервер Telegram.
 */
const api = () => (process.env.TELEGRAM_API_URL?.trim().replace(/\/$/, "") || "https://api.telegram.org");
const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";

export function botConfigured(): boolean {
  return !!(token() && telegramBotUsername());
}

export async function tgApi<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${api()}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !body?.ok) throw new Error(`Telegram ${method}: ${body?.description ?? res.status}`);
  return body.result as T;
}

/**
 * Секрет вебхука выводится из токена: отдельную переменную заводить не нужно, а подделать вебхук без токена нельзя.
 * Telegram присылает его в заголовке X-Telegram-Bot-Api-Secret-Token (допустимы A-Z a-z 0-9 _ -).
 */
export function webhookSecret(): string {
  return createHash("sha256").update(`findwork-telegram-webhook:${token()}`).digest("hex").slice(0, 48);
}

export function checkWebhookSecret(header: string | null): boolean {
  if (!token() || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(webhookSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}

export const botLink = (payload: string) => `https://t.me/${telegramBotUsername()}?start=${payload}`;
