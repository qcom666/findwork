import { cancelAutorenewal } from "@/lib/autorenew";
import { json, needUser } from "@/lib/http";

export const runtime = "nodejs";

/** Отключить своё автопродление. Принимаем всегда и сразу (п. 42 ст. 16.1 Закона о защите прав потребителей). */
export async function POST() {
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  const ok = await cancelAutorenewal(auth.user.id, "user");
  return json({ ok });
}
