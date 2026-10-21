import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { AdminPromoCreate, PromoActions } from "@/components/AdminPromo";
import { getAdmin } from "@/lib/admin";
import { listPromos, type PromoRow } from "@/lib/promo";

export const metadata: Metadata = { title: "Промокоды", robots: { index: false, follow: false } };

const dt = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU");

function status(p: PromoRow): { text: string; tone: string } {
  if (p.revoked) return { text: "отозван", tone: "bg-bad-soft text-bad" };
  if (p.expiresAt && p.expiresAt * 1000 <= Date.now()) return { text: "истёк", tone: "bg-surface-2 text-muted" };
  if (p.maxUses && p.used >= p.maxUses) return { text: "исчерпан", tone: "bg-warn-soft text-warn" };
  return { text: "активен", tone: "bg-good-soft text-good" };
}

export default async function AdminPromo() {
  if (!(await getAdmin())) notFound();
  const promos = await listPromos(100);

  return (
    <div className="space-y-6">
      <AdminNav />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Промокоды</h1>
        <p className="text-sm text-muted">Код даёт кредиты один раз каждому человеку. Для партнёров удобно создавать пачку одноразовых кодов и выдавать каждому свой.</p>
      </div>

      <AdminPromoCreate />

      <section>
        <h2 className="mb-2 text-sm font-semibold">Все коды ({promos.length})</h2>
        <ul className="card divide-y divide-line text-sm">
          {promos.length === 0 && <li className="px-4 py-3 text-muted">Кодов пока нет.</li>}
          {promos.map((p) => {
            const st = status(p);
            return (
              <li key={p.code} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <span className="min-w-0">
                  <b className="font-mono">{p.code}</b> <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.text}</span>
                  <span className="block text-muted">{p.credits} кредитов{p.note ? ` · ${p.note}` : ""}</span>
                </span>
                <span className="flex items-center gap-4 text-muted">
                  <span>использован {p.used}{p.maxUses ? ` из ${p.maxUses}` : ""}{p.expiresAt ? ` · до ${dt(p.expiresAt)}` : ""} · создан {dt(p.createdAt)}</span>
                  <PromoActions code={p.code} revoked={p.revoked} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
