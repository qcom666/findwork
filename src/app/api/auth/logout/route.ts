import { logOut } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Некорректный запрос" }, 400);
  await logOut();
  return json({ ok: true });
}
