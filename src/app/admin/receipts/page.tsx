import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { Copyable, ReceiptForm } from "@/components/AdminReceipts";
import { getAdmin } from "@/lib/admin";
import { listReceipts, type ReceiptItem } from "@/lib/receipts";

export const metadata: Metadata = { title: "Чеки", robots: { index: false, follow: false } };

// Москва живёт в UTC+3 без перехода на летнее время: даты чеков считаем по ней, как и «Мой налог».
const MSK = 3 * 3600;
const day = (s: number) => new Date((s + MSK) * 1000).toISOString().slice(0, 10).split("-").reverse().join(".");
const time = (s: number) => new Date((s + MSK) * 1000).toISOString().slice(11, 16);
const rub = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

/** При оплате картой онлайн чек можно выдать до 9-го числа следующего месяца (ч. 3 ст. 14 422-ФЗ). */
function deadline(paidAt: number): number {
  const d = new Date((paidAt + MSK) * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 10) / 1000 - MSK - 1;
}

export default async function AdminReceipts() {
  if (!(await getAdmin())) notFound();
  const [queue, issued] = await Promise.all([listReceipts(false, 200), listReceipts(true, 50)]);
  const now = Date.now() / 1000;

  return (
    <div className="space-y-6">
      <AdminNav />
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight">Чеки</h1>
        <p className="mt-1 text-sm text-muted">
          ЮKassa самозанятым чеки не выдаёт, поэтому каждый чек оформляется в «Мой налог»: «Новая продажа» → наименование и сумма отсюда,
          дата продажи — дата оплаты, покупатель — физлицо (если платили ИП или компания, укажите их ИНН) → «Выдать чек». Ссылку на чек
          отправьте покупателю и вставьте сюда: он увидит её в «Аккаунте» рядом с платежом. Возврат: в «Мой налог» аннулируйте чек с причиной
          «Возврат средств».
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Ждут чека ({queue.length})</h2>
        {queue.length === 0 ? (
          <p className="card px-4 py-3 text-sm text-muted">Все оплаты с чеками.</p>
        ) : (
          <ul className="space-y-3">
            {queue.map((r) => <Item key={r.paymentId} r={r} now={now} />)}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">С чеком (последние {issued.length})</h2>
        {issued.length === 0 ? (
          <p className="card px-4 py-3 text-sm text-muted">Пока нет.</p>
        ) : (
          <ul className="space-y-3">
            {issued.map((r) => <Item key={r.paymentId} r={r} now={now} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function Item({ r, now }: { r: ReceiptItem; now: number }) {
  const due = deadline(r.paidAt);
  const late = !r.receiptUrl && now > due;
  return (
    <li className="card space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Copyable label="Наименование" value={r.title} />
        <Copyable label="Сумма, ₽" value={rub(r.amountRub)} />
        <Copyable label={`Дата оплаты (МСК), ${time(r.paidAt)}`} value={day(r.paidAt)} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {r.hasEmail ? <Copyable label="Почта покупателя" value={r.contact} /> : <div><p className="text-xs text-muted">Покупатель</p><p className="text-sm">{r.contact}</p></div>}
        <p className="flex flex-wrap gap-2 text-xs">
          {r.ownAccount && <span className="rounded-full bg-warn-soft px-2 py-0.5 font-semibold text-warn">ваш аккаунт: если это проверка, оформите возврат</span>}
          {r.receiptUrl ? (
            <span className="text-muted">чек добавлен {r.receiptAt ? day(r.receiptAt) : ""}</span>
          ) : (
            <span className={late ? "rounded-full bg-bad-soft px-2 py-0.5 font-semibold text-bad" : "text-muted"}>
              {late ? "срок прошёл: " : "оформить до "}{day(due)}
            </span>
          )}
        </p>
      </div>
      <ReceiptForm paymentId={r.paymentId} initial={r.receiptUrl} />
    </li>
  );
}
