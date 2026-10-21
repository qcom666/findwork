"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { plural } from "@/lib/format";
import { ConsentChecks } from "./ConsentChecks";
import { TelegramAuth } from "./TelegramAuth";

export function AuthForm({ mode, next, bonus, telegramBot = null, telegramHint = false }: { mode: "login" | "signup"; next: string; bonus: number; telegramBot?: string | null; telegramHint?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accept, setAccept] = useState(false);
  const [consent, setConsent] = useState(false);
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
        body: JSON.stringify(signup ? { email, password, accept, consent } : { email, password }),
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
          Дарим {bonus} {plural(bonus, "кредит", "кредита", "кредитов")}, чтобы вы попробовали на реальных лидах.
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
        {signup && <ConsentChecks accept={accept} consent={consent} onAccept={setAccept} onConsent={setConsent} />}
        {err && <p className="text-sm text-bad">{err}</p>}
        {!signup && <p className="text-right text-sm"><Link href="/forgot" className="text-muted hover:text-ink hover:underline">Забыли пароль?</Link></p>}
        <button disabled={busy} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60">
          {busy ? "Подождите…" : signup ? "Создать аккаунт" : "Войти"}
        </button>
      </form>
      {(telegramBot || telegramHint) && (
        <div className="mt-3 card p-5">
          <TelegramAuth bot={telegramBot} next={next} hint={telegramHint} title={signup ? "Или зарегистрируйтесь через Telegram: без почты и пароля" : "Или войдите через Telegram"} />
        </div>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        {signup ? "Уже есть аккаунт?" : "Нет аккаунта?"}{" "}
        <Link href={other} className="text-accent hover:underline">{signup ? "Войти" : "Зарегистрироваться"}</Link>
      </p>
    </div>
  );
}
