export const metadata = { title: "О данных" };

export default function About() {
  return (
    <article className="max-w-2xl space-y-6 leading-relaxed">
      <h1 className="text-2xl font-semibold tracking-tight">Откуда данные и как ими пользоваться</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">Источники</h2>
        <p className="text-muted">
          Только открытые базы с разрешением на коммерческое использование. Яндекс Карты и 2ГИС мы не парсим: условия Яндекса запрещают хранить и перепродавать данные, а разрешение 2ГИС мы подтвердить не смогли.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>Overture Maps Places: лицензии CDLA-Permissive-2.0, CC0 и Apache-2.0.</li>
          <li>OpenStreetMap через Overpass: © участники OpenStreetMap, лицензия ODbL.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Что значит «сайта нет»</h2>
        <p className="text-muted">
          Это значит, что ссылки на собственный сайт нет в открытых данных. Данные неполные: у части заведений сайт есть, просто
          его не внесли. Поэтому каждая карточка ведёт на Яндекс Карты, где можно быстро проверить, и мы не называем заведение
          «без сайта» в питчах, а пишем «не нашёл ссылку в открытых источниках».
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Как считается оценка</h2>
        <p className="text-muted">
          От 0 до 100. Больше баллов, когда нет своего сайта (сильнее всего), есть телефон и e-mail, заведение не сетевое и
          относится к нише с высоким чеком работ. Сети получают штраф: решения там принимает головной офис.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Как писать владельцам</h2>
        <p className="text-muted">
          Рекламные сообщения по телефону и e-mail разрешены только с согласия получателя (ст. 18 закона «О рекламе»).
          Начинайте с личного, короткого и честного сообщения, не отправляйте массовые рассылки и сразу прекращайте писать тем,
          кто попросил. Контакты заведений — это сведения о бизнесе из открытых источников; не собирайте их для перепродажи.
        </p>
      </section>
    </article>
  );
}
