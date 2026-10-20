import { settleByProviderId, yookassaConfigured, yookassaIpAllowed } from "@/lib/billing";
import { json } from "@/lib/http";
import { clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * HTTP-уведомления ЮKassa. Подписи у них нет, поэтому мы не доверяем телу запроса:
 * берём из него только id платежа и сами запрашиваем у ЮKassa его статус и сумму.
 * ЮKassa повторяет доставку 24 часа, пока не получит ответ 200, поэтому при временной ошибке отвечаем 500.
 */
export async function POST(req: Request) {
  if (!yookassaConfigured()) return json({ error: "disabled" }, 404);
  if (process.env.YOOKASSA_ENFORCE_IP === "1" && !yookassaIpAllowed(clientIp(req))) return json({ error: "forbidden" }, 403);

  const body = (await req.json().catch(() => null)) as { type?: string; event?: string; object?: { id?: unknown } } | null;
  if (!body || body.type !== "notification") return json({ error: "bad request" }, 400);

  const id = body.object?.id;
  const relevant = body.event === "payment.succeeded" || body.event === "payment.canceled";
  if (!relevant || typeof id !== "string") return json({ ok: true }); // остальные события нам не нужны

  try {
    const result = await settleByProviderId(id);
    return json({ ok: true, result });
  } catch (e) {
    console.error("[billing] webhook settle failed", e);
    return json({ error: "try later" }, 500);
  }
}
