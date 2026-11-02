"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PLANS } from "@/lib/plans";

const TERMS = [1, 3, 6, 12];
const dt = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU");

/** Подписка в подарок по e-mail, @username или номеру пользователя. Работает как оплаченная: кредиты по месяцам и права тарифа. */
export function AdminGiftSubscription({ selfEmail }: { selfEmail: string }) {
  const router = useRouter();
  const [who, setWho] = useState("");
  const [planId, setPlanId] = useState(PLANS.find((p) => p.popular)?.id ?? PLANS[0].id);
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sending = useRef(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Кнопка гаснет только после перерисовки: быстрые клики успевали выдать несколько подписок подряд в очередь
    if (sending.current) return;
    sending.current = true;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/users/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ who, planId, months }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось");
      setMsg({ ok: true, text: `Готово: «${data.title}» на ${data.months} мес. для ${who.trim().toLowerCase()}, до ${dt(data.endsAt)}. Баланс: ${data.balance}` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const plan = PLANS.find((p) => p.id === planId);

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">Выдать подписку</h2>
        <p className="text-xs text-muted">Без оплаты. Кредиты приходят раз в месяц, права тарифа действуют весь срок. Если подписка уже есть, новая начнётся после неё.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_0.7fr_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">E-mail, @username или №</span>
          <span className="flex gap-2">
            <input required value={who} onChange={(e) => setWho(e.target.value)} className="field" placeholder="name@example.com, @username, №12" />
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setWho(selfEmail)}>Себе</button>
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Тариф</span>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="field">
            {PLANS.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.creditsPerMonth} кр./мес.</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Срок</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="field">
            {TERMS.map((m) => <option key={m} value={m}>{m} мес.</option>)}
          </select>
        </label>
        <div className="flex items-end"><button disabled={busy || !who} className="btn btn-primary">{busy ? "…" : "Выдать"}</button></div>
      </div>
      {plan && <p className="text-xs text-muted">Всего {(plan.creditsPerMonth * months).toLocaleString("ru-RU")} кредитов: по {plan.creditsPerMonth.toLocaleString("ru-RU")} в месяц, первые — в день начала подписки.</p>}
      {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </form>
  );
}
