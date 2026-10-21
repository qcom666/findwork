"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Удаление аккаунта: объясняем, что исчезнет и что останется, и просим слово «удалить» (и пароль, если он есть). */
export function DeleteAccount({ hasPassword, balance }: { hasPassword: boolean; balance: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: word, password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось удалить аккаунт");
      router.push("/");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold">Данные и приватность</h2>
      <p className="text-sm text-muted">
        Вы можете удалить аккаунт сами. Сразу исчезнут почта, пароль, привязка Telegram, заметки, питчи, открытые заведения, эксклюзивы и страницы отчётов.
        Платежи и проводки кредитов остаются без привязки к вам: их по закону нужно хранить.
        {balance > 0 && <> Оставшиеся <b className="text-ink">{balance}</b> кредитов сгорят.</>} Это действие нельзя отменить.
      </p>
      {!open ? (
        <button className="btn btn-ghost btn-sm !text-bad" onClick={() => setOpen(true)}>Удалить аккаунт</button>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Напишите «удалить»</span>
            <input value={word} onChange={(e) => setWord(e.target.value)} className="field w-40 py-1.5" autoComplete="off" required />
          </label>
          {hasPassword && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Пароль</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="field w-48 py-1.5" autoComplete="current-password" required />
            </label>
          )}
          <button disabled={busy || word.trim().toLowerCase() !== "удалить"} className="btn btn-primary btn-sm !bg-bad">{busy ? "Удаляю…" : "Удалить навсегда"}</button>
          <button type="button" className="text-xs text-muted hover:text-ink hover:underline" onClick={() => setOpen(false)}>Отмена</button>
        </form>
      )}
      {err && <p className="text-sm text-bad">{err}</p>}
    </section>
  );
}
