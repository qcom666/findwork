import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminGiftSubscription } from "@/components/AdminGiftSubscription";
import { AdminGrant } from "@/components/AdminGrant";
import { AdminNav } from "@/components/AdminNav";
import { AdminRevokeGift } from "@/components/AdminRevokeGift";
import { AdminUserCredits } from "@/components/AdminUserCredits";
import { AdminUserModeration } from "@/components/AdminUserModeration";
import { ago } from "@/lib/activity";
import { getAdmin, searchUsers } from "@/lib/admin";

export const metadata: Metadata = { title: "Пользователи", robots: { index: false, follow: false } };

const dt = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU");

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getAdmin();
  if (!admin) notFound();
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").slice(0, 80);
  const onlyBanned = (await searchParams).banned === "1";
  const users = await searchUsers(q, 50, { onlyBanned });

  return (
    <div className="space-y-6">
      <AdminNav />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Пользователи</h1>
        <p className="text-sm text-muted">Последние регистрации или поиск по e-mail, имени или @username. Кредиты можно начислить, списать или забрать все, подписку — подарить; заблокированный не может войти и пользоваться сайтом.</p>
      </div>

      <AdminGrant selfEmail={admin.email} />
      <AdminGiftSubscription selfEmail={admin.email} />

      <form className="flex max-w-md gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="E-mail, имя или @username" className="field" aria-label="Поиск пользователя" />
        {onlyBanned && <input type="hidden" name="banned" value="1" />}
        <button className="btn btn-ghost">Найти</button>
      </form>
      <div className="flex gap-2 text-sm">
        <Link href="/admin/users" className="chip" aria-current={!onlyBanned ? "true" : undefined}>Все</Link>
        <Link href="/admin/users?banned=1" className="chip" aria-current={onlyBanned ? "true" : undefined}>Заблокированные</Link>
      </div>

      <ul className="card divide-y divide-line text-sm">
        {users.length === 0 && <li className="px-4 py-3 text-muted">Никого не нашлось.</li>}
        {users.map((u) => (
          <li key={u.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-all"><b>{u.label}</b> <span className="text-muted">№{u.id} · с {dt(u.createdAt)}{u.lastSeenAt ? ` · заход ${ago(u.lastSeenAt)}` : ""} · </span>
                <Link href={`/admin/activity?user=${u.id}`} className="text-accent hover:underline">активность</Link>
                {u.banned && <span className="ml-2 rounded-md bg-bad-soft px-1.5 py-0.5 text-xs font-semibold text-bad" title={u.banReason ?? undefined}>заблокирован{u.banReason ? `: ${u.banReason}` : ""}</span>}
              </span>
              <span className="text-muted">
                баланс <b className="text-ink">{u.balance}</b> · открыто {u.unlocks}{u.paidRub > 0 ? ` · оплатил ${u.paidRub.toLocaleString("ru-RU")} ₽` : ""}
              </span>
            </div>
            {u.sub && (
              <p className="text-xs text-muted">
                Подписка <b className="text-ink">«{u.sub.title}»</b> до {dt(u.sub.until)}{u.sub.gift && " · есть подаренная"}
                {u.sub.gift && <AdminRevokeGift userId={u.id} />}
              </p>
            )}
            <AdminUserCredits userId={u.id} />
            <AdminUserModeration userId={u.id} balance={u.balance} banned={u.banned} isAdmin={u.isAdmin} />
          </li>
        ))}
      </ul>
    </div>
  );
}
