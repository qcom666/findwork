import { json } from "@/lib/http";
import { relayAllowed } from "@/lib/telegram-bot";

export const runtime = "nodejs";

/**
 * Пересылка запросов к Bot API для основного сервера в Москве: оттуда api.telegram.org недоступен, а отсюда (Vercel) доступен.
 * Включается только при TELEGRAM_RELAY=1 (задан на Vercel) и пропускает лишь запросы нашего бота (relayAllowed).
 */
export async function POST(req: Request, { params }: { params: Promise<{ bot: string; method: string }> }) {
  const { bot, method } = await params;
  if (process.env.TELEGRAM_RELAY !== "1" || !relayAllowed(bot, method, process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "")) {
    return json({ ok: false, description: "not found" }, 404);
  }
  try {
    const res = await fetch(`https://api.telegram.org/${bot}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await req.text(),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return json({ ok: false, description: "relay: Telegram недоступен" }, 502);
  }
}
