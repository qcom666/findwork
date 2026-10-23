import Link from "next/link";
import { PricingSwitcher } from "@/components/PricingSwitcher";
import { PromoForm } from "@/components/PromoForm";
import { getCurrentUser } from "@/lib/auth";
import { mockMode, PACKAGES, paymentsEnabled } from "@/lib/billing";
import { SIGNUP_BONUS, UNLOCK_COST } from "@/lib/credits";
import { pitchFeature } from "@/lib/ai";
import { dbReady } from "@/lib/db";
import { getEntitlements } from "@/lib/entitlements";
import { plural } from "@/lib/format";
import { PLANS } from "@/lib/plans";
import { seller } from "@/lib/seller";
import { getStats } from "@/lib/search";
import { getSubscriptions } from "@/lib/subscriptions";

export const metadata = {
  title: "Тарифы и оплата",
  description: "Подписка или разовые кредиты на контакты заведений. Без автопродления, кредиты не сгорают, неиспользованные возвращаем.",
};

const day = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const num = (n: number) => n.toLocaleString("ru-RU");

export default async function Pricing() {
  const [user, ready] = await Promise.all([getCurrentUser(), dbReady()]);
  const [subs, stats, ent] = await Promise.all([
    user ? getSubscriptions(user.id) : [],
    ready ? getStats().catch(() => null) : null,
    user ? getEntitlements(user.id) : null,
  ]);
  const enabled = paymentsEnabled();
  const sub = subs[0];
  const start = PLANS[0];

  return (
    <div className="space-y-8">
      <header className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight">Тарифы и оплата</h1>
        <p className="mt-2 text-muted">
          Искать и смотреть заведения бесплатно. {UNLOCK_COST} {plural(UNLOCK_COST, "кредит", "кредита", "кредитов")} открывает одно заведение целиком:
          телефон, e-mail, соцсети, ссылку на сайт, проверку сайта и питч. Оплата картой через защищённую страницу, данные карты нам не передаются.
        </p>
      </header>

      <section className="card p-5 sm:p-6" aria-label="Текущий статус">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Текущий статус</p>
        {user ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p>
              {sub ? (
                <>
                  <b>«{sub.title}»</b>
                  <span className="text-muted"> — {num(sub.creditsPerMonth)} контактов в месяц, оплачена до {day(sub.endsAt)}</span>
                  {subs.length > 1 && <span className="text-muted">; следом оплачена ещё одна</span>}
                </>
              ) : (
                <>
                  <b>Без подписки</b>
                  <span className="text-muted"> — вы платите только за открытые контакты</span>
                </>
              )}
              <span className="mt-1 block text-sm text-muted">
                На балансе <b className="text-ink">{num(user.balance)}</b> {plural(user.balance, "кредит", "кредита", "кредитов")}
                {sub?.nextGrantAt && <>, следующие кредиты по подписке {day(sub.nextGrantAt)}</>}
              </span>
            </p>
            <Link href="/account" className="btn btn-ghost btn-sm">Аккаунт и платежи</Link>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p>
              <b>Вы не вошли</b>
              <span className="text-muted">
                {SIGNUP_BONUS > 0 ? ` — за вход через Telegram дарим ${SIGNUP_BONUS} ${plural(SIGNUP_BONUS, "кредит", "кредита", "кредитов")}, карта не нужна` : " — зарегистрируйтесь, чтобы открывать контакты"}
              </span>
            </p>
            <Link href="/signup?next=/pricing" className="btn btn-primary btn-sm">Создать аккаунт</Link>
          </div>
        )}
      </section>

      <section className="pricing-proof rounded-2xl p-6 text-white sm:p-8" aria-label="Что вы получаете">
        <div className="flex flex-wrap gap-x-12 gap-y-6">
          {stats && (
            <>
              <Figure value={num(stats.places)} label="заведений в базе" />
              <Figure value={num(stats.candidates)} label="без своего сайта" />
              <Figure value={num(stats.cities)} label={plural(stats.cities, "город", "города", "городов")} />
            </>
          )}
          <Figure value={num(start.creditsPerMonth)} label={`контактов в месяц на «${start.title}»`} />
        </div>
        <ul className="mt-6 grid gap-3 border-t border-white/15 pt-5 text-sm text-white/85 sm:grid-cols-3">
          <li><b className="text-white">Без автопродления.</b> Платите один раз за срок, карта не привязывается.</li>
          <li><b className="text-white">Кредиты не сгорают.</b> Остаток переходит на следующий месяц.</li>
          <li><b className="text-white">Возвращаем неиспользованное.</b> По письму, в течение 10 рабочих дней.</li>
        </ul>
      </section>

      {sub && (
        <p className="rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          У вас уже есть подписка «{sub.title}». Новая начнётся после её окончания, оплаченное время не потеряется.
        </p>
      )}
      {mockMode() && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Тестовый режим: ЮKassa не подключена, оплата подтверждается кнопкой без реальных денег. В продакшене этого режима нет.
        </p>
      )}

      <section className="space-y-4" aria-labelledby="choose-plan">
        <div>
          <h2 id="choose-plan" className="text-xs font-semibold uppercase tracking-wider text-muted">Выбрать тариф</h2>
          <p className="mt-1 text-sm text-muted">
            Чем дольше срок, тем ниже цена контакта. Количество контактов точное, без «примерно»: сколько указано, столько и получите.
          </p>
        </div>
        <PricingSwitcher packages={PACKAGES} enabled={enabled} packageDiscountPct={ent?.packageDiscountPct ?? 0} pitchLabel={pitchFeature()} />
      </section>

      {user && (
        <section className="max-w-md space-y-2">
          <h2 className="text-sm font-semibold">Есть промокод?</h2>
          <PromoForm />
        </section>
      )}

      <div className="max-w-3xl space-y-1 text-xs text-muted">
        <p>
          Цены указаны в рублях. Оплата банковской картой, через СБП и другими способами ЮKassa. Условия возврата: <Link href="/refund" className="underline">«Оплата и возврат»</Link> и{" "}
          <Link href="/terms" className="underline">оферта</Link>.
        </p>
        <p>
          Данные карты вводятся на защищённой странице и нам не передаются. По вопросам оплаты: <a href={`mailto:${seller.email()}`} className="underline">{seller.email()}</a>.
        </p>
      </div>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">{value}</p>
      <p className="mt-1 max-w-[12rem] text-sm text-white/70">{label}</p>
    </div>
  );
}
