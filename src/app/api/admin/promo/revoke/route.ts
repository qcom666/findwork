import { getAdmin } from "@/lib/admin";
import { json, readJson } from "@/lib/http";
import { revokePromo } from "@/lib/promo";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await getAdmin())) return json({ error: "not found" }, 404);
  const b = await readJson<{ code?: string }>(req);
  if (!b || typeof b.code !== "string") return json({ error: "Не указан код" }, 400);
  return (await revokePromo(b.code)) ? json({ ok: true }) : json({ error: "Код не найден" }, 404);
}
