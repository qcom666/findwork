import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminGiftSubscription } from "@/components/AdminGiftSubscription";
import { AdminGrant } from "@/components/AdminGrant";
import { AdminNav } from "@/components/AdminNav";
import { getAdmin } from "@/lib/admin";
import { getLabels } from "@/lib/search";
import { getMetrics } from "@/lib/metrics";
import { listReceipts } from "@/lib/receipts";

export const metadata: Metadata = { title: "Метрики", robots: { index: false, follow: false } };

const rub = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
const dt = (s: number) => new Date(s * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
const STATUS: Record<string, string> = { pending: "ждёт оплаты", succeeded: "оплачен", canceled: "отменён", failed: "ошибка" };

export default async function Admin() {
  // Для всех остальных страницы не существует: ADMIN_EMAILS не задан или вы не в списке.
  const admin = await getAdmin();
  if (!admin) notFound();

  const [m, labels, noReceipt] = await Promise.all([getMetrics(), getLabels(), listReceipts(false, 500)]);
  const conv = m.users.total ? Math.round((m.users.payers / m.users.total) * 1000) / 10 : 0;

  return (
    <div className="space-y-8">
      <AdminNav />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Обзор</h1>
        <p className="text-sm text-muted">Только для владельца. Данные считаются при открытии страницы, тестовые платежи не входят в выручку.</p>
      </div>

      {noReceipt.length > 0 && (
        <Link href="/admin/receipts" className="block rounded-lg bg-warn-soft px-4 py-3 text-sm font-medium text-warn hover:underline">
          Оплат без чека: {noReceipt.length}. Оформите чеки в «Мой налог» →
        </Link>
      )}

      <AdminGrant selfEmail={admin.email} />
      <AdminGiftSubscription selfEmail={admin.email} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Выручка всего" value={rub(m.money.revenueRub)} sub={`за 30 дней: ${rub(m.money.revenue30Rub)}`} />
        <Tile label="Оплат" value={String(m.money.payments)} sub={`ждут: ${m.money.pending} · сорвались: ${m.money.failed}`} />
        <Tile label="Регистраций" value={String(m.users.total)} sub={`за 7 дней: ${m.users.d7} · за 30: ${m.users.d30}`} />
        <Tile label="Платят" value={`${conv}%`} sub={`${m.users.payers} из ${m.users.total}`} />
        <Tile label="Открыто лидов" value={String(m.usage.unlocks)} sub={`за 7 дней: ${m.usage.unlocks7}`} />
        <Tile label="Активных за неделю" value={String(m.users.active7)} sub="открывали лиды" />
        <Tile label="Продано кредитов" value={String(m.money.creditsSold)} sub="без ваших аккаунтов" />
        <Tile label="Кредитов на балансах" value={String(m.usage.creditsLeft)} sub="не потрачено, без ваших аккаунтов" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Регистрации по дням</h2>
          <ul className="card divide-y divide-line text-sm">
            {m.signupsByDay.length === 0 && <li className="px-4 py-3 text-muted">Пока нет.</li>}
            {m.signupsByDay.map((d) => (
              <li key={d.day} className="flex justify-between px-4 py-2.5"><span className="text-muted">{d.day}</span><b>{d.n}</b></li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold">Что открывают чаще (последние 500)</h2>
          <ul className="card divide-y divide-line text-sm">
            {m.topNiches.length === 0 && <li className="px-4 py-3 text-muted">Пока нет.</li>}
            {m.topNiches.map((n) => (
              <li key={n.niche} className="flex justify-between px-4 py-2.5"><span>{labels.niches[n.niche] ?? n.niche}</span><b>{n.n}</b></li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Последние платежи</h2>
        <ul className="card divide-y divide-line text-sm">
          {m.recentPayments.length === 0 && <li className="px-4 py-3 text-muted">Платежей пока не было.</li>}
          {m.recentPayments.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span>{p.email} · {p.credits} кредитов · {rub(p.amountRub)}</span>
              <span className="text-muted">{STATUS[p.status] ?? p.status} · {dt(p.at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}
