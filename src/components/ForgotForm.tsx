"use client";

import Link from "next/link";
import { useState } from "react";

export function ForgotForm({ supportEmail }: { supportEmail: string | null }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "sent" | "off">("idle");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      setState(data.configured === false ? "off" : "sent");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Сброс пароля</h1>
      {state === "sent" ? (
        <p className="card mt-5 p-5 text-sm">Если такой e-mail зарегистрирован, мы отправили на него ссылку для нового пароля. Она действует час. Проверьте и папку «Спам».</p>
      ) : state === "off" ? (
        <p className="card mt-5 p-5 text-sm">
          Сброс по почте пока не подключён.
          {supportEmail ? <> Напишите на <a className="text-accent hover:underline" href={`mailto:${supportEmail}`}>{supportEmail}</a> с адреса, на который зарегистрирован аккаунт.</> : " Мы скоро это исправим."}
        </p>
      ) : (
        <form onSubmit={submit} className="card mt-5 space-y-3 p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">E-mail аккаунта</span>
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field" />
          </label>
          {err && <p className="text-sm text-bad">{err}</p>}
          <button disabled={busy} className="btn btn-primary w-full">{busy ? "Отправляю…" : "Отправить ссылку"}</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-muted"><Link href="/login" className="text-accent hover:underline">Вернуться ко входу</Link></p>
    </div>
  );
}
