"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthForm({ mode, next, bonus }: { mode: "login" | "signup"; next: string; bonus: number }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const signup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Ошибка");
      router.push(next);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  const other = `${signup ? "/login" : "/signup"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{signup ? "Регистрация" : "Вход"}</h1>
      {signup && bonus > 0 && (
        <p className="mt-2 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          Дарим {bonus} кредитов, чтобы вы попробовали на реальных лидах.
        </p>
      )}
      <form onSubmit={submit} className="mt-5 space-y-3 card p-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">E-mail</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Пароль {signup && "(от 8 символов)"}</span>
          <input
            type="password" required minLength={signup ? 8 : 1} autoComplete={signup ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} className="field"
          />
        </label>
        {err && <p className="text-sm text-bad">{err}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60">
          {busy ? "Подождите…" : signup ? "Создать аккаунт" : "Войти"}
        </button>
        {signup && (
          <p className="text-xs text-muted">
            Регистрируясь, вы принимаете <Link href="/terms" className="underline">оферту</Link> и{" "}
            <Link href="/privacy" className="underline">политику конфиденциальности</Link>.
          </p>
        )}
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        {signup ? "Уже есть аккаунт?" : "Нет аккаунта?"}{" "}
        <Link href={other} className="text-accent hover:underline">{signup ? "Войти" : "Зарегистрироваться"}</Link>
      </p>
    </div>
  );
}
