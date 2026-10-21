"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BATCH_SIZE } from "@/lib/limits";
import { useProfile } from "./useProfile";

type Service = { id: string; label: string };

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "email", label: "E-mail" },
  { id: "call", label: "Звонок" },
];

const MAX_PER_RUN = 40;

/** Пишет питчи сразу для многих открытых лидов, у которых их ещё нет. Тексты сохраняются и появляются в списке. */
export function BatchPitch({ eligible, services }: { eligible: string[]; services: Service[] }) {
  const router = useRouter();
  const [profile, update] = useProfile();
  const [service, setService] = useState("auto");
  const [channel, setChannel] = useState("whatsapp");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [fromClaude, setFromClaude] = useState(0);
  const [err, setErr] = useState("");
  const [finished, setFinished] = useState(false);

  const batch = eligible.slice(0, MAX_PER_RUN);
  const total = batch.length;

  async function run() {
    setBusy(true); setErr(""); setDone(0); setFailed(0); setFromClaude(0); setFinished(false);
    let ok = 0, bad = 0, claude = 0;
    try {
      for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE);
        const res = await fetch("/api/pitch/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk, service, channel, profile }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Не удалось написать питчи");
        for (const r of data.results as { ok: boolean; source?: string }[]) {
          if (r.ok) { ok++; if (r.source === "claude") claude++; } else bad++;
        }
        setDone(ok); setFailed(bad); setFromClaude(claude);
      }
      setFinished(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  if (eligible.length === 0 && !finished) {
    return <p className="card px-4 py-3 text-sm text-muted">У всех лидов на этой странице уже есть питч или они на поздних этапах. Новые питчи появятся у новых открытых лидов.</p>;
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Питчи для всех сразу</h2>
        <p className="text-sm text-muted">
          Для {eligible.length} {eligible.length === 1 ? "лида" : "лидов"} без питча. Тексты сохранятся, вы сможете поправить и отправить каждый в один клик.
          {eligible.length > MAX_PER_RUN ? ` За один раз пишем ${MAX_PER_RUN}.` : ""}
        </p>
      </div>

      <details className="rounded-xl border border-line px-3 py-2" open={!profile.name}>
        <summary className="cursor-pointer text-sm font-medium">Мой профиль для текстов{profile.name ? `: ${profile.name}` : ""}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Имя" value={profile.name} onChange={(v) => update({ name: v })} placeholder="Алексей" />
          <Field label="Цена от" value={profile.priceFrom} onChange={(v) => update({ priceFrom: v })} placeholder="15 000 ₽" />
          <Field label="Что делаю" value={profile.skills} onChange={(v) => update({ skills: v })} placeholder="Лендинги и сайты для малого бизнеса" className="sm:col-span-2" />
          <Field label="Портфолио (ссылка)" value={profile.portfolio} onChange={(v) => update({ portfolio: v })} placeholder="https://" className="sm:col-span-2" />
        </div>
      </details>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Что предлагаем</span>
          <select value={service} onChange={(e) => setService(e.target.value)} className="field">
            <option value="auto">Подбирать под каждого заведения</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Канал</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="field">
            {CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={busy || total === 0} className="btn btn-primary">
          {busy ? `Пишу… ${done + failed} из ${total}` : `Написать ${total} ${total === 1 ? "питч" : "питчей"}`}
        </button>
        {busy && <progress className="h-2 w-40 accent-[var(--accent)]" value={done + failed} max={total} />}
        {finished && (
          <span className="text-sm text-good">
            Готово: {done} {fromClaude > 0 ? `(из них ${fromClaude} от Claude)` : "(шаблоны)"}{failed ? `, не получилось: ${failed}` : ""}
          </span>
        )}
      </div>
      {err && <p className="text-sm text-bad">{err}</p>}
      <p className="text-xs text-muted">
        Перед отправкой проверьте факты. Рекламу по телефону и e-mail можно слать только с согласия получателя (ст. 18 закона «О рекламе»), поэтому
        не отправляйте тексты списком: каждое сообщение отправляете вы сами.
      </p>
    </section>
  );
}

function Field({ label, value, onChange, placeholder, className = "" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="field" />
    </label>
  );
}
