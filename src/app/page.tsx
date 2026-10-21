import Link from "next/link";
import { PricingSwitcher } from "@/components/PricingSwitcher";
import { RoiCalculator } from "@/components/RoiCalculator";
import { ARTICLES, readingMinutes } from "@/content/articles";
import { ScoreRing } from "@/components/ScoreRing";
import { getCurrentUser } from "@/lib/auth";
import { PACKAGES, paymentsEnabled } from "@/lib/billing";
import { SIGNUP_BONUS, UNLOCK_COST } from "@/lib/credits";
import { dbReady } from "@/lib/db";
import { SERVICE_SHORT, plural } from "@/lib/format";
import { PLANS, planPerLead } from "@/lib/plans";
import { getNiches, getStats, type Option, type Stats } from "@/lib/search";
import { getAllCities, type CityInfo } from "@/lib/seo";

const STEPS = [
  { n: "1", title: "Выберите, что вы делаете", text: "Сайты, QR-меню, онлайн-запись, соцсети, логотипы. Каталог сразу сужается до подходящих заведений." },
  { n: "2", title: "Оцените лид бесплатно", text: "Оценка от 0 до 100, причины и список услуг, которые стоит предложить, видны без оплаты." },
  { n: "3", title: "Откройте контакты", text: `За ${UNLOCK_COST} кредит: телефон, e-mail, соцсети, ссылка на сайт и проверка сайта на слабые места.` },
  { n: "4", title: "Отправьте питч", text: "Claude пишет первое сообщение под заведение и ваш профиль. Вы правите и отправляете сами." },
];

const FEATURES = [
  { title: "Честная оценка", text: "Видно, из чего сложилась оценка: нет сайта, есть телефон, не сеть, ниша с высоким чеком. Никаких загадочных баллов." },
  { title: "Проверка сайта", text: "Открываем сайт заведения и ищем слабые места: HTTPS, мобильная версия, телефон одним нажатием, заброшенность." },
  { title: "Питч без воды", text: "Короткий текст с одним предложением и одним вопросом. Не выдумывает факты и не обещает «рост продаж в 3 раза»." },
  { title: "Статусы и заметки", text: "Отмечайте, кому написали, кто ответил и с кем сделка. Все открытые лиды выгружаются в CSV." },
];

const WHY = [
  { title: "Готово сразу", text: "Каталог собран заранее, поиск и фильтры отвечают за секунды. Не нужно ждать, пока сервис «соберёт» заведения под ваш запрос." },
  { title: "Законные данные", text: "Открытые лицензии (Overture Maps, OpenStreetMap), а не парсинг карт. Нет блокировок и очередей, и не нужно гадать, можно ли использовать эти данные." },
  { title: "Платите за нужное", text: "Кредиты не сгорают, подписка без автопродления и пробных списаний, неиспользованные кредиты возвращаем." },
  { title: "Оценка до оплаты", text: "Оценка лида, причины и что предложить видны бесплатно. Контакты открываете только у тех заведений, которые подходят." },
];

// Сравнение с типичными сервисами-парсерами карт: без названий, с оговоркой «как правило», и честная строка про охват.
const COMPARE: { row: string; us: string; them: string }[] = [
  { row: "Источник данных", us: "Открытые лицензии: Overture Maps, OpenStreetMap", them: "Парсинг карт-сервисов без явного разрешения" },
  { row: "Ожидание", us: "Поиск за секунды: база готова", them: "Сбор «на лету» в очереди, дольше при больших запросах" },
  { row: "До оплаты", us: "Весь каталог без регистрации", them: "Часто только после входа" },
  { row: "Число контактов", us: "Точное: сколько указано, столько и получите", them: "«Примерно»: считают по числу запусков сбора" },
  { row: "Оплата", us: "Кредиты без срока или подписка без автопродления", them: "Ежемесячная подписка с автосписанием" },
  { row: "Возврат", us: "Неиспользованные кредиты возвращаем", them: "Как правило, только при двойном списании" },
  { row: "Охват", us: "Сотни тысяч заведений России, база растёт", them: "Шире: весь каталог карты и города СНГ" },
];

const FAQ = [
  { q: "Откуда данные?", a: "Из открытых баз Overture Maps и OpenStreetMap, лицензии которых разрешают коммерческое использование. Яндекс Карты и 2ГИС мы не парсим: условия Яндекса запрещают хранить и перепродавать данные, а разрешение 2ГИС мы подтвердить не смогли." },
  { q: "Что значит «сайта нет»?", a: "Ссылки на собственный сайт нет в открытых данных. Бывает, что сайт есть, а его просто не внесли, поэтому в карточке есть быстрая проверка на картах, а питч пишет «не нашёл ссылку», а не «у вас нет сайта»." },
  { q: "Можно ли писать заведениям?", a: "Да, но рекламу по телефону и e-mail по закону (ст. 18 «О рекламе») можно слать только с согласия получателя. Начинайте с короткого личного сообщения, не делайте массовых рассылок и сразу прекращайте писать тем, кто попросил." },
  { q: "За что я плачу?", a: "За открытие контактов одного заведения, вместе с проверкой сайта и питчем. Просматривать каталог, оценки и причины бесплатно. Кредиты не сгорают." },
  { q: "Чем это отличается от парсеров 2ГИС?", a: "Парсер собирает данные с карты в момент запроса, поэтому вы ждёте очередь, зависите от блокировок и используете данные, которые сервис карт не разрешал собирать. У нас каталог готов заранее и собран из открытых лицензий, поэтому поиск мгновенный, а использование понятное. Взамен охват у нас пока меньше, чем у полного каталога карты, и мы говорим об этом прямо." },
  { q: "Подписка продлевается сама?", a: "Нет. Вы платите один раз за выбранный срок (1, 3 или 12 месяцев), карта не привязывается и повторных списаний не будет. Кредиты приходят раз в месяц, по окончании срока подписка просто заканчивается, а начисленные кредиты остаются у вас." },
  { q: "Сколько данных в базе?", a: "Сотни тысяч заведений в крупных городах. Это меньше, чем в закрытых картах, зато данные открытые и честные. Каталог растёт с каждым обновлением." },
];

export default async function Home() {
  const ready = await dbReady();
  const [stats, niches, cities, user] = await Promise.all([
    ready ? getStats().catch(() => null) : null,
    ready ? getNiches().catch(() => [] as Option[]) : ([] as Option[]),
    ready ? getAllCities().catch(() => [] as CityInfo[]) : ([] as CityInfo[]),
    getCurrentUser(),
  ]);
  const topNiches = niches.slice(0, 8);
  const calcPrice = planPerLead(PLANS.find((p) => p.popular) ?? PLANS[0], 1);

  return (
    <div className="space-y-20 pb-8">
      <section className="pb-4 pt-8 sm:pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-good" /> Для фрилансеров и небольших студий
            </p>
            <h1 className="text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
              Клиенты среди заведений, у которых ещё нет сайта
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              {stats ? `${stats.places.toLocaleString("ru-RU")} заведений России на открытых данных. ` : ""}
              FindWork находит тех, кому нужен сайт, QR-меню, онлайн-запись или соцсети, оценивает лид и пишет первое сообщение.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/leads" className="btn btn-primary">Смотреть лиды</Link>
              {!user && (
                <Link href="/signup" className="btn btn-ghost">
                  {SIGNUP_BONUS > 0 ? `Получить ${SIGNUP_BONUS} кредитов` : "Регистрация"}
                </Link>
              )}
            </div>
            <p className="mt-4 text-sm text-muted">Каталог открыт без регистрации{SIGNUP_BONUS > 0 ? `, ${SIGNUP_BONUS} кредитов в подарок без карты` : ""}. Дальше платите за открытые контакты: кредитами или подпиской без автопродления.</p>
          </div>

          <div className="relative mx-auto w-full max-w-sm pb-4 sm:pb-28 lg:max-w-none" aria-hidden="true">
            <div className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Пример карточки</p>
                  <p className="mt-1 text-lg font-bold">Студия «Лотос»</p>
                  <p className="text-sm text-muted">Салоны красоты · Ваш город</p>
                </div>
                <ScoreRing score={84} size="3.25rem" />
              </div>
              <dl className="mt-5 space-y-2.5 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted">Сайт</dt><dd><span className="rounded-full bg-good-soft px-2.5 py-0.5 text-xs font-semibold text-good">Только соцсети</span></dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">Телефон</dt><dd>🔒 +7 (900) •••-••-••</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">E-mail</dt><dd>🔒 •••@mail.ru</dd></div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                {["Сайты", "Онлайн-запись", "SEO и карты"].map((t) => (
                  <span key={t} className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">{t}</span>
                ))}
              </div>
              <div className="btn btn-primary mt-5 w-full">Открыть контакты за 1 кредит</div>
            </div>
            <div className="card absolute bottom-0 left-4 hidden w-64 p-4 sm:block">
              <p className="text-xs font-semibold text-muted">Питч</p>
              <p className="mt-1 text-sm leading-snug">Здравствуйте! Не нашёл ссылку на ваш сайт в открытых источниках. Могу взять это на себя…</p>
            </div>
          </div>
        </div>
      </section>

      {stats && (
        <section aria-label="Цифры" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat value={stats.places} label="заведений в базе" />
          <Stat value={stats.candidates} label="кандидатов без своего сайта" />
          <Stat value={stats.cities} label={plural(stats.cities, "город", "города", "городов")} />
          <Stat value={stats.niches} label={plural(stats.niches, "ниша", "ниши", "ниш")} />
        </section>
      )}

      <section className="space-y-8">
        <SectionTitle title="Как это работает" sub="От выбора ниши до отправленного сообщения за несколько минут." />
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="card p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-sm font-bold text-accent">{s.n}</span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-8">
        <SectionTitle title="Почему FindWork" sub="Мы не парсим карты на лету: каталог собран заранее из открытых данных. Это быстрее, спокойнее и дешевле для вас." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map((w) => (
            <div key={w.title} className="card p-5">
              <h3 className="font-semibold">{w.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{w.text}</p>
            </div>
          ))}
        </div>
        <div className="card overflow-hidden text-sm">
          <div className="hidden grid-cols-[9rem_1fr_1fr] gap-4 border-b border-line bg-surface-2 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted sm:grid">
            <span />
            <span className="text-accent">FindWork</span>
            <span>Сервисы-парсеры карт, как правило</span>
          </div>
          <dl className="divide-y divide-line">
            {COMPARE.map((c) => (
              <div key={c.row} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[9rem_1fr_1fr] sm:gap-4">
                <dt className="font-semibold">{c.row}</dt>
                <dd><span className="text-xs font-semibold text-accent sm:hidden">FindWork: </span>{c.us}</dd>
                <dd className="text-muted"><span className="text-xs font-semibold sm:hidden">Парсеры: </span>{c.them}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-muted">
          Сравнение с типичными сервисами-парсерами; у отдельных сервисов условия могут отличаться.{" "}
          <Link href="/blog/parser-2gis-ili-otkrytye-dannye" className="text-accent hover:underline">Подробнее: парсер 2ГИС или открытые данные</Link>.
        </p>
      </section>

      {topNiches.length > 0 && (
        <section className="space-y-8">
          <SectionTitle title="Популярные ниши" sub="Столько заведений без собственного сайта сейчас в каталоге." />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {topNiches.map((n) => (
              <Link key={n.id} href={`/leads?niche=${n.id}`} className="card group p-4 transition-colors hover:border-accent">
                <p className="font-semibold group-hover:text-accent">{n.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{n.nNeed.toLocaleString("ru-RU")}</p>
                <p className="text-xs text-muted">лидов без своего сайта</p>
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(SERVICE_SHORT).map(([id, label]) => (
              <Link key={id} href={`/leads?service=${id}`} className="chip">{label}</Link>
            ))}
          </div>
        </section>
      )}

      {cities.length > 0 && (
        <section className="space-y-6">
          <SectionTitle title="Города" sub="Лиды без сайта по крупным городам России." />
          <div className="flex flex-wrap gap-2">
            {cities.slice(0, 16).map((c) => (
              <Link key={c.slug} href={`/city/${c.slug}`} className="chip">
                {c.name} <span className="count">{c.nNeed.toLocaleString("ru-RU")}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-8">
        <SectionTitle title="Что внутри" sub="Всё, чтобы быстро найти клиента и не потерять переписку." />
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-8">
        <SectionTitle title="Сколько можно заработать" sub="Подставьте свои цифры: цена лида считается по тарифу «Студия» на месяц." />
        <RoiCalculator pricePerLead={calcPrice} />
      </section>

      <section className="space-y-8">
        <SectionTitle title="Тарифы" sub={`Подписка или разовые кредиты. ${UNLOCK_COST} кредит — одно заведение со всеми инструментами.`} />
        <PricingSwitcher packages={PACKAGES} enabled={paymentsEnabled()} />
        <p className="text-sm text-muted">
          Кредиты не сгорают. {SIGNUP_BONUS > 0 && `При регистрации дарим ${SIGNUP_BONUS}. `}
          <Link href="/pricing" className="text-accent hover:underline">Подробнее о тарифах</Link>
        </p>
      </section>

      <section className="space-y-6">
        <SectionTitle title="Из блога" sub="Как искать клиентов среди местного бизнеса и писать им так, чтобы отвечали." />
        <div className="grid gap-4 md:grid-cols-3">
          {ARTICLES.slice(0, 3).map((a) => (
            <Link key={a.slug} href={`/blog/${a.slug}`} className="card group flex flex-col p-5 transition-colors hover:border-accent">
              <h3 className="font-semibold leading-snug group-hover:text-accent">{a.title}</h3>
              <p className="mt-2 flex-1 text-sm text-muted">{a.description}</p>
              <p className="mt-3 text-xs text-muted">{readingMinutes(a)} мин чтения</p>
            </Link>
          ))}
        </div>
        <Link href="/blog" className="text-sm text-accent hover:underline">Все статьи →</Link>
      </section>

      <section className="space-y-6">
        <SectionTitle title="Вопросы и ответы" />
        <div className="card divide-y divide-line">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {f.q}
                <span className="text-muted transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="card hero-bg px-6 py-12 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Найдите первого клиента сегодня</h2>
        <p className="mx-auto mt-2 max-w-lg text-muted">Посмотрите каталог без регистрации. Когда найдёте подходящее заведение, откройте контакты.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/leads" className="btn btn-primary">Смотреть лиды</Link>
          {!user && <Link href="/signup" className="btn btn-ghost">Создать аккаунт</Link>}
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      {sub && <p className="mt-1 max-w-2xl text-muted">{sub}</p>}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="card p-5">
      <p className="text-3xl font-bold tabular-nums tracking-tight">{value.toLocaleString("ru-RU")}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

export type { Stats };
