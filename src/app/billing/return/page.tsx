import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/Small";
import { getCurrentUser } from "@/lib/auth";
import { getPayment, settleByProviderId } from "@/lib/billing";
import { plural } from "@/lib/format";
import { getSubscriptionByPayment } from "@/lib/subscriptions";

export const metadata = { title: "Оплата" };

export default async function BillingReturn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  const id = typeof sp.payment === "string" ? sp.payment : "";
  if (!user) redirect(`/login?next=${encodeURIComponent(`/billing/return?payment=${id}`)}`);

  let p = id ? await getPayment(user.id, id) : null;
  // Вебхук мог ещё не прийти: спрашиваем статус у ЮKassa сами.
  if (p && p.status === "pending" && p.provider === "yookassa" && p.providerPaymentId) {
    await settleByProviderId(p.providerPaymentId).catch((e) => console.error("[billing] return settle failed", e));
    p = await getPayment(user.id, id);
  }
  const sub = p && p.status === "succeeded" && p.kind === "subscription" ? await getSubscriptionByPayment(user.id, p.id) : null;
  const date = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="mx-auto max-w-md card p-6 text-center">
      {!p ? (
        <>
          <h1 className="text-xl font-semibold">Платёж не найден</h1>
          <Link href="/pricing" className="mt-4 inline-block text-accent hover:underline">К тарифам</Link>
        </>
      ) : p.status === "succeeded" ? (
        <>
          <h1 className="text-xl font-semibold text-good">Оплата прошла</h1>
          {sub ? (
            <p className="mt-2 text-muted">
              Подписка «{sub.title}» оплачена до {date(sub.endsAt)} Кредиты приходят раз в месяц по {sub.creditsPerMonth}
              {sub.startsAt * 1000 <= Date.now() ? "; за первый месяц уже начислены" : `, первые ${date(sub.startsAt)}, когда закончится предыдущая подписка`}. Баланс: {user.balance}.
            </p>
          ) : (
            <p className="mt-2 text-muted">
              Зачислено {p.credits} {plural(p.credits, "кредит", "кредита", "кредитов")}. Баланс: {user.balance}.
            </p>
          )}
          <Link href="/leads" className="btn btn-primary mt-5">Искать лиды</Link>
        </>
      ) : p.status === "pending" ? (
        <>
          <h1 className="text-xl font-semibold">Ждём подтверждения платежа</h1>
          <p className="mt-2 text-muted">Обычно это занимает несколько секунд. Страница обновится сама.</p>
          <AutoRefresh />
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-bad">Платёж не прошёл</h1>
          <p className="mt-2 text-muted">Деньги не списаны. Можно попробовать ещё раз.</p>
          <Link href="/pricing" className="mt-5 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90">К тарифам</Link>
        </>
      )}
    </div>
  );
}
