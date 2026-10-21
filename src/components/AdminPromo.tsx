"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Создание промокодов: один (со своим кодом или случайным) или пачка случайных. */
export function AdminPromoCreate() {
  const router = useRouter();
  const [f, setF] = useState({ code: "", prefix: "", credits: "10", maxUses: "", days: "", note: "", count: "1" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const batch = Number(f.count) > 1;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setCodes([]);
    try {
      const res = await fetch("/api/admin/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: batch ? undefined : f.code, prefix: f.prefix, credits: Number(f.credits), count: Number(f.count) || 1,
          maxUses: f.maxUses ? Number(f.maxUses) : null, days: f.days ? Number(f.days) : null, note: f.note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось создать");
      setCodes(data.codes);
      setF({ ...f, code: "" });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function csv() {
    const body = "﻿код;кредитов;заметка\r\n" + codes.map((c) => `${c};${f.credits};${f.note.replace(/;/g, ",")}`).join("\r\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "findwork-promocodes.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Сколько кодов (1 — один)"><input type="number" min={1} max={100} value={f.count} onChange={set("count")} className="field" /></Field>
        {batch ? (
          <Field label="Префикс (необязательно)"><input value={f.prefix} onChange={set("prefix")} className="field uppercase" maxLength={12} placeholder="BLOG" /></Field>
        ) : (
          <Field label="Свой код (пусто: случайный)"><input value={f.code} onChange={set("code")} className="field uppercase" maxLength={32} placeholder="SPRING10" /></Field>
        )}
        <Field label="Кредитов за код"><input type="number" min={1} max={1000} value={f.credits} onChange={set("credits")} className="field" required /></Field>
        <Field label={batch ? "Использований на код (пусто: 1)" : "Использований (пусто: без лимита)"}><input type="number" min={1} value={f.maxUses} onChange={set("maxUses")} className="field" /></Field>
        <Field label="Срок, дней (пусто: бессрочно)"><input type="number" min={1} value={f.days} onChange={set("days")} className="field" /></Field>
        <Field label="Заметка (кому выдан)" wide><input value={f.note} onChange={set("note")} className="field" maxLength={200} /></Field>
        <div className="flex items-end gap-3 sm:col-span-2">
          <button disabled={busy} className="btn btn-primary">{busy ? "Создаю…" : batch ? `Создать ${f.count} кодов` : "Создать промокод"}</button>
          {err && <span className="text-sm text-bad">{err}</span>}
        </div>
      </form>

      {codes.length > 0 && (
        <div className="card space-y-3 border-good p-4">
          <p className="text-sm font-semibold text-good">Создано кодов: {codes.length}</p>
          <textarea readOnly value={codes.join("\n")} rows={Math.min(8, codes.length)} onFocus={(e) => e.currentTarget.select()} className="field font-mono text-sm" />
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(codes.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>
              {copied ? "Скопировано" : "Копировать все"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={csv}>Скачать CSV</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export function PromoActions({ code, revoked }: { code: string; revoked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex gap-3 text-xs">
      <button className="text-accent hover:underline" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} }}>
        {copied ? "Скопировано" : "Копировать"}
      </button>
      {!revoked && (
        <button
          disabled={busy}
          className="text-bad hover:underline disabled:opacity-50"
          onClick={async () => {
            if (!confirm(`Отозвать код ${code}? Использовать его больше будет нельзя.`)) return;
            setBusy(true);
            await fetch("/api/admin/promo/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
            setBusy(false);
            router.refresh();
          }}
        >
          Отозвать
        </button>
      )}
    </span>
  );
}
