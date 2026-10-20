import { unlockLead } from "@/lib/credits";
import { json, needUser, readJson } from "@/lib/http";
import { leadExists } from "@/lib/search";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ id?: string }>(req);
  if (!b?.id || typeof b.id !== "string") return json({ error: "Не указан id" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;

  if (!(await leadExists(b.id))) return json({ error: "Заведение не найдено" }, 404);

  const r = await unlockLead(auth.user.id, b.id);
  if (!r.ok) return json({ error: "Не хватает кредитов", balance: r.balance, needCredits: true }, 402);
  return json({ ok: true, charged: r.charged, balance: r.balance });
}
