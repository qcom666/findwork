import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminGiftSubscription } from "@/components/AdminGiftSubscription";
import { AdminNav } from "@/components/AdminNav";
import { AdminRevokeGift } from "@/components/AdminRevokeGift";
import { getAdmin, listSubscriptions } from "@/lib/admin";

export const metadata: Metadata = { title: "Подписки", robots: { index: false, follow: false } };

const date = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });

export default async function AdminSubscriptions() {
  const admin = await getAdmin();
  if (!admin) notFound();
  const subs = await listSubscriptions();
  const t = Math.floor(Date.now() / 1000);
  const active = subs.filter((s) => s.startsAt <= t);
  const gifts = subs.filter((s) => s.gift).length;

  return (
    <div className="space-y-6">
      <AdminNav />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Подписки</h1>
        <p className="text-sm text-muted">Выдать подписку без оплаты себе или любому пользователю и посмотреть, у кого какая подписка сейчас.</p>
      </div>

      <AdminGiftSubscription selfEmail={admin.email} />

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Действуют: {active.length}{subs.length > active.length ? ` · в очереди: ${subs.length - active.length}` : ""}{gifts > 0 ? ` · подаренных: ${gifts}` : ""}
        </h2>
        <ul className="card divide-y divide-line text-sm">
          {subs.length === 0 && <li className="px-4 py-3 text-muted">Подписок пока нет.</li>}
          {subs.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0 break-all">
                <Link prefetch={false} href={`/admin/activity?user=${s.userId}`} className="font-medium hover:underline">{s.user}</Link>
                {" · "}<b>«{s.title}»</b> на {s.months} мес.
                {s.gift ? <span className="ml-1.5 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">подарок</span> : <span className="ml-1.5 text-xs text-muted">оплачена</span>}
                {s.startsAt > t && <span className="ml-1.5 text-xs text-warn">в очереди</span>}
              </span>
              <span className="text-muted">
                {date(s.startsAt)} – {date(s.endsAt)} · начислено {s.granted} из {s.months} мес. по {s.creditsPerMonth} кр.
                {s.gift && <AdminRevokeGift userId={s.userId} />}
              </span>
            </li>
          ))}
        </ul>
        {gifts > 0 && <p className="mt-2 text-xs text-muted">«Снять подарок» снимает все подаренные подписки человека; оплаченные не трогает.</p>}
      </section>
    </div>
  );
}
