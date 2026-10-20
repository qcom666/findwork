import { appBaseUrl, createCheckout, getPackage, paymentsEnabled } from "@/lib/billing";
import { json, needUser, readJson } from "@/lib/http";
import { allow } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const b = await readJson<{ package?: string }>(req);
  const pkg = b?.package ? getPackage(b.package) : undefined;
  if (!pkg) return json({ error: "Неизвестный пакет" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (!paymentsEnabled()) return json({ error: "Оплата пока не настроена" }, 503);
  if (!(await allow(`checkout:${auth.user.id}`, 20, 3600))) return json({ error: "Слишком много попыток оплаты, попробуйте позже" }, 429);

  try {
    const { url } = await createCheckout(auth.user, pkg, appBaseUrl(req));
    return json({ url });
  } catch (e) {
    console.error("[billing] checkout failed", e);
    return json({ error: "Не удалось создать платёж. Попробуйте ещё раз." }, 502);
  }
}
