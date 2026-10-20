import { BuyButton } from "@/components/BuyButton";
import { getCurrentUser } from "@/lib/auth";
import { mockMode, PACKAGES, paymentsEnabled } from "@/lib/billing";
import { SIGNUP_BONUS, UNLOCK_COST } from "@/lib/credits";
import { plural } from "@/lib/format";

export const metadata = { title: "Тарифы — FindWork" };

export default async function Pricing() {
  const user = await getCurrentUser();
  const enabled = paymentsEnabled();
  const rub = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

  return (
    <div className="space-y-6">
      <section className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Кредиты на лиды</h1>
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

      {mockMode() && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Тестовый режим: ЮKassa не подключена, оплата подтверждается кнопкой без реальных денег. В продакшене этого режима нет.
        </p>
      )}
      {!enabled && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Приём оплаты скоро заработает. Кредиты за регистрацию уже можно тратить.</p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {PACKAGES.map((p, i) => (
          <section key={p.id} className={`rounded-2xl border bg-surface p-5 ${i === 1 ? "border-accent" : "border-line"}`}>
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">{p.title}</h2>
              {i === 1 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">выгоднее</span>}
            </div>
            <div className="mt-3 text-3xl font-semibold">{p.priceRub.toLocaleString("ru-RU")} ₽</div>
            <p className="mt-1 text-sm text-muted">
              {p.credits} {plural(p.credits, "кредит", "кредита", "кредитов")} · {rub(p.priceRub / p.credits)} ₽ за лид
            </p>
            <div className="mt-5">{enabled ? <BuyButton packageId={p.id} primary={i === 1} /> : null}</div>
          </section>
        ))}
      </div>

      <p className="max-w-2xl text-xs text-muted">
        Оплата банковской картой, СБП и другими способами через ЮKassa. Данные карты мы не видим и не храним. Условия возврата — в{" "}
        <a href="/terms" className="underline">оферте</a>.
      </p>
    </div>
  );
}
