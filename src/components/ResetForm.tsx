"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      router.push("/");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Новый пароль</h1>
      <form onSubmit={submit} className="card mt-5 space-y-3 p-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Пароль (от 8 символов)</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="field" />
        </label>
        {err && <p className="text-sm text-bad">{err} <Link href="/forgot" className="underline">Запросить новую ссылку</Link></p>}
        <button disabled={busy} className="btn btn-primary w-full">{busy ? "Сохраняю…" : "Сохранить и войти"}</button>
      </form>
    </div>
  );
}
