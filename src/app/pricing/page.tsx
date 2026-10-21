import { PricingSwitcher } from "@/components/PricingSwitcher";
import { PromoForm } from "@/components/PromoForm";
import { getCurrentUser } from "@/lib/auth";
import { mockMode, PACKAGES, paymentsEnabled } from "@/lib/billing";
import { SIGNUP_BONUS, UNLOCK_COST } from "@/lib/credits";
import { plural } from "@/lib/format";
import { getSubscriptions } from "@/lib/subscriptions";

export const metadata = { title: "Тарифы" };

export default async function Pricing() {
  const user = await getCurrentUser();
  const enabled = paymentsEnabled();
  const subs = user ? await getSubscriptions(user.id) : [];

  return (
    <div className="space-y-6">
      <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Тарифы</h1>
        <p className="mt-2 text-muted">
          Искать и смотреть заведения бесплатно. {UNLOCK_COST} {plural(UNLOCK_COST, "кредит", "кредита", "кредитов")} открывает одно
          заведение целиком: телефон, e-mail, соцсети, ссылку на сайт, проверку сайта и питч. Повторное открытие того же лида бесплатно,
          кредиты не сгорают.
        </p>
        {!user && SIGNUP_BONUS > 0 && (
          <p className="mt-3 inline-block rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
            При регистрации дарим {SIGNUP_BONUS} кредитов.
          </p>
        )}
      </section>

      {subs.length > 0 && (
        <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          У вас уже есть подписка «{subs[0].title}». Новая начнётся после её окончания, оплаченное время не потеряется.
        </p>
      )}
      {mockMode() && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Тестовый режим: ЮKassa не подключена, оплата подтверждается кнопкой без реальных денег. В продакшене этого режима нет.
        </p>
      )}
      {!enabled && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Приём оплаты скоро заработает. Кредиты за регистрацию уже можно тратить.</p>
      )}

      <PricingSwitcher packages={PACKAGES} enabled={enabled} />

      {user && (
        <section className="max-w-md space-y-2">
          <h2 className="text-sm font-semibold">Есть промокод?</h2>
          <PromoForm />
        </section>
      )}

      <p className="max-w-2xl text-xs text-muted">
        Оплата банковской картой, СБП и другими способами через ЮKassa. Данные карты мы не видим и не храним. Условия возврата — на странице{" "}
        <a href="/refund" className="underline">«Оплата и возврат»</a> и в <a href="/terms" className="underline">оферте</a>.
      </p>
    </div>
  );
}
