import { getAdmin } from "@/lib/admin";
import { appBaseUrl } from "@/lib/billing";
import { json, readJson } from "@/lib/http";
import { botConfigured, tgApi, webhookSecret } from "@/lib/telegram-bot";

export const runtime = "nodejs";

/** Владелец одним нажатием подключает вебхук бота: токен остаётся на сервере и нигде не вводится. */
export async function POST(req: Request) {
  if (!(await getAdmin())) return json({ error: "not found" }, 404);
  if (!(await readJson<Record<string, never>>(req))) return json({ error: "Некорректный запрос" }, 400);
  if (!botConfigured()) return json({ error: "Не заданы TELEGRAM_BOT_USERNAME и TELEGRAM_BOT_TOKEN" }, 503);
  try {
    const url = `${appBaseUrl(req)}/api/telegram/webhook`;
    await tgApi("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    return json({ ok: true, url });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
}
