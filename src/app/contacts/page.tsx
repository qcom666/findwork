import Link from "next/link";
import { seller } from "@/lib/seller";

export const metadata = { title: "Контакты и реквизиты", description: "Как связаться с FindWork и реквизиты продавца." };

export default function Contacts() {
  const site = process.env.APP_URL || "https://findwork-rouge.vercel.app";
  return (
    <article className="max-w-2xl space-y-8 leading-relaxed">
      <h1 className="text-2xl font-bold tracking-tight">Контакты и реквизиты</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">Связаться с нами</h2>
        <p className="text-muted">
          Почта: <a href={`mailto:${seller.email()}`} className="text-accent hover:underline">{seller.email()}</a>. Отвечаем по будням.
          По вопросам оплаты и возврата смотрите <Link href="/refund" className="text-accent hover:underline">«Оплата и возврат»</Link>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Реквизиты</h2>
        <dl className="card divide-y divide-line text-sm">
          <Row label="Продавец">{seller.name()}</Row>
          <Row label="ИНН">{seller.inn()}</Row>
          <Row label="Сайт">{site}</Row>
          <Row label="Услуга">Доступ к сведениям о заведениях из открытых источников: контакты, проверка сайта, подготовка текста</Row>
        </dl>
      </section>

      {!seller.configured() && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          Реквизиты продавца ещё не заполнены. Перед приёмом платежей задайте SELLER_NAME, SELLER_INN и SUPPORT_EMAIL.
        </p>
      )}
    </article>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
