import { createHash, timingSafeEqual } from "node:crypto";
import { telegramBotUsername } from "./telegram";

/**
 * Клиент Bot API и проверка вебхука. Токен бота лежит только в окружении сервера и никуда не отдаётся.
 * TELEGRAM_API_URL: куда слать запросы к Bot API. Тесты подставляют поддельный сервер Telegram, а сервер в Москве,
 * откуда api.telegram.org недоступен, ходит через пересылку на Vercel (/api/tg-relay, см. relayAllowed).
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

let checked = { at: 0, url: "" };

/** Только для тестов: забыть, что вебхук уже проверяли. */
export function __resetWebhookCheck(): void {
  checked = { at: 0, url: "" };
}

/**
 * Следит, чтобы Telegram присылал сообщения бота на этот сайт: если вебхук не тот, подключает его сам. Так вход через бота
 * не зависит от того, нажал ли владелец кнопку в админке. Проверка кэшируется на 5 минут. Бросает ошибку, если Telegram не принял токен.
 */
export async function ensureWebhook(baseUrl: string): Promise<void> {
  // TELEGRAM_WEBHOOK_BASE: адрес, на который Telegram может достучаться. Сервер в Москве Telegram не видит, поэтому вебхук
  // смотрит на копию на Vercel, а она пересылает его сюда (FORWARD_WEBHOOKS_TO в next.config.ts).
  const base = process.env.TELEGRAM_WEBHOOK_BASE?.trim() || baseUrl;
  const url = `${base.replace(/\/$/, "")}/api/telegram/webhook`;
  if (checked.url === url && Date.now() - checked.at < 5 * 60_000) return;
  const info = await tgApi<{ url?: string }>("getWebhookInfo");
  if (info?.url !== url) {
    await tgApi("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"] });
  }
  checked = { at: Date.now(), url };
}

/** Номер бота из токена «123456:ABC…»: он не меняется, даже если токен перевыпустили в @BotFather. */
const botId = (t: string) => t.split(":")[0];

/**
 * Пересылка к Bot API (/api/tg-relay на Vercel) пропускает только запросы нашего бота: часть пути bot<токен> должна
 * относиться к тому же боту, что и токен этой установки. Проверяем номер бота, а не весь токен, чтобы перевыпуск токена
 * на основном сервере не ломал пересылку. Чужой бот или метод с посторонними символами не пройдут.
 */
export function relayAllowed(botPart: string, method: string, ownToken: string): boolean {
  const m = /^bot(\d+):[\w-]{20,}$/.exec(botPart);
  return !!m && !!ownToken && m[1] === botId(ownToken) && /^[A-Za-z]{1,40}$/.test(method);
}
