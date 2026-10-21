import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { AdminUserCredits } from "@/components/AdminUserCredits";
import { getAdmin, searchUsers } from "@/lib/admin";

export const metadata: Metadata = { title: "Пользователи", robots: { index: false, follow: false } };

const dt = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU");

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await getAdmin())) notFound();
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").slice(0, 80);
  const users = await searchUsers(q, 50);

  return (
    <div className="space-y-6">
      <AdminNav />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Пользователи</h1>
        <p className="text-sm text-muted">Последние регистрации или поиск по части e-mail. Кредиты можно начислить или списать вручную: это попадёт в историю пользователя.</p>
      </div>

      <form className="flex max-w-md gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Часть e-mail" className="field" aria-label="Поиск по e-mail" />
        <button className="btn btn-ghost">Найти</button>
      </form>

      <ul className="card divide-y divide-line text-sm">
        {users.length === 0 && <li className="px-4 py-3 text-muted">Никого не нашлось.</li>}
        {users.map((u) => (
          <li key={u.id} className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-all"><b>{u.email}</b> <span className="text-muted">№{u.id} · с {dt(u.createdAt)}</span></span>
              <span className="text-muted">
                баланс <b className="text-ink">{u.balance}</b> · открыто {u.unlocks}{u.paidRub > 0 ? ` · оплатил ${u.paidRub.toLocaleString("ru-RU")} ₽` : ""}
              </span>
            </div>
            <AdminUserCredits userId={u.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
