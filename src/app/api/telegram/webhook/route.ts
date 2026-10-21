import { json } from "@/lib/http";
import { handleBotUpdate } from "@/lib/tg-login";
import { checkWebhookSecret } from "@/lib/telegram-bot";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Сюда Telegram присылает сообщения боту. Подлинность: секрет в заголовке, он выводится из токена бота. */
export async function POST(req: Request) {
  if (!checkWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) return json({ error: "forbidden" }, 401);
  const update = await req.json().catch(() => null);
  // Всегда 200: иначе Telegram будет присылать то же обновление снова и снова.
  await handleBotUpdate(update).catch((e) => console.error("[telegram] обработка обновления не удалась", e));
  return json({ ok: true });
}
