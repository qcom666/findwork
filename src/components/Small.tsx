"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
      className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent"
    >
      Выйти
    </button>
  );
}

/** Пока платёж ждёт подтверждения, перезапрашиваем страницу раз в несколько секунд. */
export function AutoRefresh({ everyMs = 4000, max = 15 }: { everyMs?: number; max?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > max) return clearInterval(t);
      router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, max]);
  return null;
}

export function MockPay({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true); setErr("");
          const res = await fetch("/api/billing/mock-confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payment: paymentId }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok) {
            setErr("Не удалось подтвердить тестовый платёж");
            setBusy(false);
            return;
          }
          router.push(`/billing/return?payment=${paymentId}`);
          router.refresh();
        }}
        className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Проводим…" : "Оплатить (тест)"}
      </button>
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
    </div>
  );
}
