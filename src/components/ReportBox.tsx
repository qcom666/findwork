"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Profile } from "./useProfile";

export type ReportItem = { token: string; createdAt: number; expiresAt: number; views: number; revoked: boolean };
export type QuotaView = { included: number; left: number; cost: number; planTitle: string | null };

const day = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

/**
 * Отчёт о проверке сайта для владельца заведения: публичная страница по ссылке с находками и контактами автора.
 * Контакты автора берутся из профиля (хранится в браузере) и уходят на сервер только в момент создания.
 */
export function ReportBox({ leadId, profile, quota, reports, balance }: { leadId: string; profile: Profile; quota: QuotaView; reports: ReportItem[]; balance: number }) {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const ready = !!profile.name.trim() && !!profile.contact.trim();
  const free = quota.left > 0;
  const noCredits = !free && balance < quota.cost;

  async function create() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, profile, publish: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось создать отчёт");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: string) {
    setErr("");
    const res = await fetch("/api/report/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    if (res.ok) router.refresh();
    else setErr("Не удалось отозвать ссылку");
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(`${origin}/report/${token}`);
      setCopied(token);
      setTimeout(() => setCopied(""), 1500);
    } catch {}
  }

  const live = reports.filter((r) => !r.revoked && r.expiresAt * 1000 > Date.now());

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">Отчёт для клиента</h2>
      <p className="text-xs text-muted">
        Ссылка на страницу с результатом проверки сайта и вашими контактами: отправьте её владельцу вместе с питчем. Ссылка живёт 30 дней, видно, сколько раз её открыли.
      </p>
      <p className="mt-2 text-xs text-muted">
        {quota.included > 0 ? (
          <>По тарифу «{quota.planTitle}» входит {quota.included} отчётов за 30 дней, осталось <b className="text-ink">{quota.left}</b>{!free && <>, дальше {quota.cost} кредит за отчёт</>}.</>
        ) : (
          <>Отчёт стоит {quota.cost} кредит. <Link href="/pricing" className="text-accent hover:underline">По подписке</Link> часть отчётов входит в тариф.</>
        )}
      </p>

      <label className="mt-4 flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
        <span>Разрешаю показать моё имя, контакт и портфолио из профиля на странице отчёта. Её увидит каждый, у кого есть ссылка.</span>
      </label>
      <button onClick={create} disabled={busy || !agree || !ready || noCredits} className="btn btn-primary btn-sm mt-3">
        {busy ? "Создаю…" : `Создать ссылку${free ? "" : ` · ${quota.cost} кредит`}`}
      </button>
      {!ready && <p className="mt-2 text-xs text-warn">Заполните имя и контакт в профиле ниже: их увидит владелец заведения.</p>}
      {noCredits && <p className="mt-2 text-xs text-warn">Не хватает кредитов. <Link href="/pricing" className="underline">Пополнить</Link></p>}
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}

      {live.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {live.map((r) => (
            <li key={r.token} className="rounded-xl border border-line px-3 py-2">
              <div className="flex gap-2">
                <input readOnly value={`${origin}/report/${r.token}`} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка на отчёт" className="field" />
                <button className="btn btn-ghost btn-sm shrink-0" onClick={() => copy(r.token)}>{copied === r.token ? "Скопировано" : "Копировать"}</button>
              </div>
              <p className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>Открыли {r.views} раз · до {day(r.expiresAt)}</span>
                <button className="text-bad hover:underline" onClick={() => revoke(r.token)}>Отозвать</button>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
