import { PACKAGES } from "@/lib/billing";
import { SIGNUP_BONUS, UNLOCK_COST } from "@/lib/credits";
import { seller } from "@/lib/seller";

export const metadata = { title: "Оферта" };

export default function Terms() {
  return (
    <article className="max-w-2xl space-y-5 leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">Публичная оферта</h1>
      <p className="text-muted">
        Исполнитель: {seller.name()}, ИНН {seller.inn()}. Связь: {seller.email()}.
      </p>

      <section className="space-y-2">
        <h2 className="font-semibold">1. Что продаём</h2>
        <p className="text-muted">
          Сервис FindWork показывает сведения о заведениях из открытых источников (Overture Maps, OpenStreetMap). Просмотр списка, названия,
          адреса и оценки бесплатный. За {UNLOCK_COST} кредит пользователь открывает контактные данные одного заведения, проверку его сайта и
          подготовку текста первого сообщения. Повторное открытие того же заведения не списывает кредиты.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">2. Цены</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          {PACKAGES.map((p) => (
            <li key={p.id}>{p.credits} кредитов — {p.priceRub.toLocaleString("ru-RU")} ₽</li>
          ))}
          {SIGNUP_BONUS > 0 && <li>При регистрации начисляется {SIGNUP_BONUS} бесплатных кредитов.</li>}
        </ul>
        <p className="text-muted">Кредиты не имеют срока действия и не обмениваются на деньги, кроме случаев, указанных в разделе 4.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">3. Оплата</h2>
        <p className="text-muted">
          Оплата проходит через ЮKassa банковской картой и другими доступными там способами. После подтверждения платежа кредиты
          зачисляются на баланс автоматически. Данные карты сервису не передаются.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">4. Возврат</h2>
        <p className="text-muted">
          Неиспользованные кредиты можно вернуть, написав на {seller.email()}: деньги вернутся тем же способом, которым была оплата.
          Кредиты, которыми уже открыты контакты, не возвращаются: услуга оказана в момент открытия. Если платёж прошёл, а кредиты
          не появились, напишите нам, и мы разберёмся или вернём деньги.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">5. Данные и ответственность</h2>
        <p className="text-muted">
          Сведения о заведениях взяты из открытых источников и могут быть неполными или устаревшими, мы не гарантируем их точность и
          результат работы с ними. Пользователь сам отвечает за соблюдение закона при обращении к заведениям, в том числе требований
          ст. 18 закона «О рекламе» о согласии на получение рекламы. Запрещено перепродавать выгрузки сервиса.
        </p>
      </section>

      {!seller.configured() && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Реквизиты продавца ещё не заполнены. Перед приёмом платежей задайте SELLER_NAME, SELLER_INN и SUPPORT_EMAIL.
        </p>
      )}
    </article>
  );
}
