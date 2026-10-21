import { json, needUser, readJson } from "@/lib/http";
import { revokeReport } from "@/lib/reports";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ token?: string }>(req);
  if (!b?.token || typeof b.token !== "string") return json({ error: "Не указана ссылка" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  return (await revokeReport(auth.user.id, b.token)) ? json({ ok: true }) : json({ error: "Ссылка не найдена" }, 404);
}
