"use client";

import { useEffect, useState } from "react";

type Finding = { level: "bad" | "warn" | "ok" | "info"; text: string };
type Audit = { url: string; reachable: boolean; findings: Finding[]; ms?: number; builder?: string };
type Profile = { name: string; skills: string; portfolio: string; priceFrom: string };
type Pitch = { subject: string; message: string; followup: string; angle: string };
type Service = { id: string; label: string };

const CHANNELS = [
  { id: "telegram", label: "Telegram" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "E-mail" },
  { id: "call", label: "Звонок" },
];

const LEVEL = {
  bad: { dot: "bg-bad", text: "text-bad" },
  warn: { dot: "bg-warn", text: "text-warn" },
  ok: { dot: "bg-good", text: "text-good" },
  info: { dot: "bg-muted/60", text: "text-muted" },
} as const;

const EMPTY: Profile = { name: "", skills: "", portfolio: "", priceFrom: "" };
const KEY = "findwork.profile";

export function LeadTools({ leadId, hasWebsite, services }: { leadId: string; hasWebsite: boolean; services: Service[] }) {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditErr, setAuditErr] = useState("");
  const [service, setService] = useState(services[0]?.id ?? "site");
  const [channel, setChannel] = useState("telegram");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [note, setNote] = useState("");
  const [source, setSource] = useState<"claude" | "template" | "">("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setProfile({ ...EMPTY, ...JSON.parse(raw) });
    } catch {}
  }, []);

  function updateProfile(patch: Partial<Profile>) {
    const next = { ...profile, ...patch };
    setProfile(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  }

  async function runAudit() {
    setAuditing(true); setAuditErr("");
    try {
      const res = await fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: leadId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка проверки");
      setAudit(data);
    } catch (e) {
      setAuditErr((e as Error).message);
    } finally {
      setAuditing(false);
    }
  }

  async function runPitch() {
    setBusy(true); setErr(""); setNote("");
    try {
      const res = await fetch("/api/pitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, service, channel, profile, audit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка генерации");
      setPitch(data.pitch); setSource(data.source); setNote(data.note ?? "");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {hasWebsite && (
        <section className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Проверка сайта</h2>
              <p className="text-xs text-muted">Открываем сайт и ищем слабые места: телефон, HTTPS, адаптивность.</p>
            </div>
            <button onClick={runAudit} disabled={auditing} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50">
              {auditing ? "Проверяю…" : audit ? "Проверить ещё раз" : "Проверить"}
            </button>
          </div>
          {auditErr && <p className="mt-3 text-sm text-bad">{auditErr}</p>}
          {audit && (
            <ul className="mt-4 space-y-2 text-sm">
              {audit.findings.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL[f.level].dot}`} />
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card p-5">
        <h2 className="text-sm font-semibold">Питч</h2>
        <p className="text-xs text-muted">Первое сообщение владельцу. Сначала расскажите о себе, это сохранится в браузере.</p>

        <details className="mt-3 rounded-xl border border-line px-3 py-2" open={!profile.name}>
          <summary className="cursor-pointer text-sm font-medium">Мой профиль</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Input label="Имя" value={profile.name} onChange={(v) => updateProfile({ name: v })} placeholder="Алексей" />
            <Input label="Цена от" value={profile.priceFrom} onChange={(v) => updateProfile({ priceFrom: v })} placeholder="15 000 ₽" />
            <Input label="Что делаю" value={profile.skills} onChange={(v) => updateProfile({ skills: v })} placeholder="Лендинги на Tilda и Next.js" className="sm:col-span-2" />
            <Input label="Портфолио (ссылка)" value={profile.portfolio} onChange={(v) => updateProfile({ portfolio: v })} placeholder="https://" className="sm:col-span-2" />
          </div>
        </details>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Что предлагаем</span>
            <select value={service} onChange={(e) => setService(e.target.value)} className="field">
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

        <button onClick={runPitch} disabled={busy} className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60">
          {busy ? "Пишу…" : pitch ? "Переписать" : "Сгенерировать питч"}
        </button>
        {err && <p className="mt-3 text-sm text-bad">{err}</p>}

        {pitch && (
          <div className="mt-5 space-y-4">
            {pitch.subject && <Block title="Тема" text={pitch.subject} />}
            <Block title={channel === "call" ? "Скрипт звонка" : "Сообщение"} text={pitch.message} />
            <Block title="Если нет ответа через 3–4 дня" text={pitch.followup} />
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">{pitch.angle}</p>
            <p className="text-xs text-muted">
              {source === "claude" ? "Текст написан Claude." : "Шаблон без ИИ."} {note}
            </p>
            <p className="text-xs text-muted">
              Перед отправкой проверьте факты. Рекламные сообщения по телефону и e-mail можно слать только с согласия
              получателя (ст. 18 закона «О рекламе»), поэтому лучше начинать с личного вопроса и без массовых рассылок.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, className = "" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="field" />
    </label>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{title}</span>
        <button onClick={copy} className="text-xs text-accent hover:underline">{copied ? "Скопировано" : "Копировать"}</button>
      </div>
      <div className="whitespace-pre-wrap rounded-xl border border-line bg-bg px-3 py-2.5 text-sm leading-relaxed">{text}</div>
    </div>
  );
}
