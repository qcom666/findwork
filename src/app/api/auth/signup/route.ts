import { signUp, validateCredentials } from "@/lib/auth";
import { json, readJson } from "@/lib/http";
import { allow, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ email?: string; password?: string }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");

  const bad = validateCredentials(email, password);
  if (bad) return json({ error: bad }, 400);
  if (!(await allow(`signup:${clientIp(req)}`, 5, 3600))) return json({ error: "Слишком много регистраций с вашего адреса. Попробуйте позже." }, 429);

  const r = await signUp(email, password);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 409);
}
