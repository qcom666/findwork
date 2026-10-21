import { signUp, validateCredentials } from "@/lib/auth";
import { LEGAL_VERSION } from "@/lib/legal";
import { json, readJson } from "@/lib/http";
import { allow, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ email?: string; password?: string; accept?: boolean; consent?: boolean }>(req);
  if (!b) return json({ error: "Некорректный запрос" }, 400);
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");

  const bad = validateCredentials(email, password);
  if (bad) return json({ error: bad }, 400);
  // Оферта и согласие на обработку персональных данных принимаются двумя отдельными отметками.
  if (b.accept !== true || b.consent !== true) return json({ error: "Примите оферту и дайте согласие на обработку персональных данных" }, 400);
  if (!(await allow(`signup:${clientIp(req)}`, 5, 3600))) return json({ error: "Слишком много регистраций с вашего адреса. Попробуйте позже." }, 429);

  const r = await signUp(email, password, LEGAL_VERSION);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 409);
}
