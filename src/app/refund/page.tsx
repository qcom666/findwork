import Link from "next/link";
import { seller } from "@/lib/seller";

export const metadata = { title: "Оплата и возврат", description: "Как проходит оплата кредитов FindWork и когда можно вернуть деньги." };

export default function Refund() {
  return (
    <article className="max-w-2xl space-y-6 leading-relaxed">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Оплата и возврат</h1>
        <p className="mt-1 text-sm text-muted">Редакция от 21.10.2026</p>
      </header>

      <Section title="1. Как оплатить">
        <p>
          Платежи принимаются в рублях через платёжный сервис ЮKassa: банковскими картами, через СБП и другими способами, которые покажет ЮKassa.
          Данные карты вводятся на защищённой странице ЮKassa и нам не передаются.
        </p>
      </Section>

      <Section title="2. Что вы покупаете">
        <p>
          Пакет кредитов. После подтверждения платежа кредиты зачисляются на баланс автоматически, обычно за несколько секунд. Подписки и автопродления нет:
          списание происходит один раз, при покупке. Кредиты не сгорают. Один кредит открывает контакты одного заведения вместе с проверкой сайта и питчем.
          Чек отправляется на e-mail, указанный при оплате, или формируется в приложении «Мой налог», если продавец применяет НПД.
        </p>
      </Section>

      <Section title="3. Когда возвращаем деньги">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Двойное или ошибочное списание: возвращаем полностью.</li>
          <li>Платёж прошёл, а кредиты не зачислились, и мы не смогли это исправить: возвращаем полностью.</li>
          <li>Неиспользованные кредиты: возвращаем их стоимость по цене пакета, в котором они куплены. Бонусные кредиты не возвращаются.</li>
        </ul>
        <p>
          Кредиты, которыми уже открыты контакты, не возвращаются: услуга оказана в момент открытия. Это не ограничивает права потребителя,
          предусмотренные законом РФ «О защите прав потребителей».
        </p>
      </Section>

      <Section title="4. Как оформить возврат">
        <p>
          Напишите на {seller.email()} и укажите e-mail аккаунта, дату и сумму платежа и причину. Мы рассмотрим обращение в течение 3 рабочих дней.
          Если основание есть, деньги вернутся тем же способом, которым вы платили, в течение 10 рабочих дней.
        </p>
      </Section>

      <Section title="5. Реквизиты">
        <p>{seller.name()}, ИНН {seller.inn()}. Подробнее на странице <Link href="/contacts" className="text-accent hover:underline">контактов</Link> и в <Link href="/terms" className="text-accent hover:underline">оферте</Link>.</p>
      </Section>

      {!seller.configured() && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Реквизиты продавца ещё не заполнены. Перед приёмом платежей задайте SELLER_NAME, SELLER_INN и SUPPORT_EMAIL.
        </p>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title}</h2>
      <div className="space-y-2 text-muted">{children}</div>
    </section>
  );
}
