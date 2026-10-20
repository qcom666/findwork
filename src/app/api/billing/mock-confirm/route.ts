import { confirmMockPayment, mockMode } from "@/lib/billing";
import { json, needUser, readJson } from "@/lib/http";

export const runtime = "nodejs";

/** Тестовая «оплата» для разработки. Без ключей ЮKassa и только вне продакшена; в продакшене всегда 404. */
export async function POST(req: Request) {
  if (!mockMode()) return json({ error: "not found" }, 404);
  const b = await readJson<{ payment?: string }>(req);
  if (!b?.payment) return json({ error: "Не указан платёж" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  const ok = await confirmMockPayment(auth.user.id, b.payment);
  return json({ ok });
}
