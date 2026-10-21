import { appBaseUrl, createCheckout, createSubscriptionCheckout, getPackage, paymentsEnabled } from "@/lib/billing";
import { json, needUser, readJson } from "@/lib/http";
import { getPeriod, getPlan } from "@/lib/plans";
import { allow } from "@/lib/ratelimit";
import { isTgEmail } from "@/lib/telegram";

export const runtime = "nodejs";

/** Тело запроса: {package} для разовых кредитов или {plan, months} для подписки. */
export async function POST(req: Request) {
  const b = await readJson<{ package?: string; plan?: string; months?: number }>(req);
  const pkg = b?.package ? getPackage(b.package) : undefined;
  const plan = b?.plan ? getPlan(b.plan) : undefined;
  if (!pkg && !plan) return json({ error: "Неизвестный тариф" }, 400);
  if (plan && !getPeriod(Number(b?.months))) return json({ error: "Неизвестный срок подписки" }, 400);
  const auth = await needUser();
  if ("error" in auth) return auth.error;
  if (!paymentsEnabled()) return json({ error: "Оплата пока не настроена" }, 503);
  // Чек ЮKassa уходит на e-mail покупателя; у аккаунта из Telegram настоящей почты нет.
  if (process.env.YOOKASSA_RECEIPT === "1" && isTgEmail(auth.user.email)) {
    return json({ error: "Для оплаты с чеком нужен e-mail. Напишите в поддержку или зарегистрируйтесь по e-mail." }, 409);
  }
  if (!(await allow(`checkout:${auth.user.id}`, 20, 3600))) return json({ error: "Слишком много попыток оплаты, попробуйте позже" }, 429);

  try {
    const base = appBaseUrl(req);
    const { url } = plan ? await createSubscriptionCheckout(auth.user, plan, Number(b?.months), base) : await createCheckout(auth.user, pkg!, base);
    return json({ url });
  } catch (e) {
    console.error("[billing] checkout failed", e);
    return json({ error: "Не удалось создать платёж. Попробуйте ещё раз." }, 502);
  }
}
