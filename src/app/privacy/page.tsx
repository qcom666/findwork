import { seller } from "@/lib/seller";

export const metadata = { title: "Политика конфиденциальности — FindWork" };

export default function Privacy() {
  return (
    <article className="max-w-2xl space-y-5 leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">Политика конфиденциальности</h1>
      <p className="text-muted">Оператор: {seller.name()}, ИНН {seller.inn()}. Связь: {seller.email()}.</p>

      <section className="space-y-2">
        <h2 className="font-semibold">Какие данные мы храним</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>e-mail и хэш пароля (сам пароль мы не храним);</li>
          <li>историю платежей и кредитов, список открытых вами заведений;</li>
          <li>технические данные: IP-адрес для защиты от злоупотреблений, файл cookie сессии.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Зачем</h2>
        <p className="text-muted">
          Чтобы вы могли войти в аккаунт, платить и пользоваться купленным, а мы могли защитить сервис. Данные банковской карты обрабатывает
          ЮKassa, к нам они не попадают. Профиль для питчей (имя, портфолио, цена) хранится только в вашем браузере.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Кому передаём</h2>
        <p className="text-muted">
          ЮKassa (платежи), хостинг-провайдеру и поставщику базы данных (хранение), а при генерации питча в Anthropic уходит описание заведения
          и ваш профиль из формы, без вашего e-mail. Мы не продаём и не передаём ваши данные рекламодателям.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Ваши права</h2>
        <p className="text-muted">Чтобы получить копию данных или удалить аккаунт, напишите на {seller.email()}.</p>
      </section>
    </article>
  );
}
