"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function BuyButton({ packageId, primary }: { packageId: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function buy() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: packageId }),
      });
      if (res.status === 401) return router.push("/signup?next=/pricing");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Не удалось начать оплату");
      window.location.href = data.url;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={buy}
        disabled={busy}
        className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${
          primary ? "bg-accent text-accent-ink hover:opacity-90" : "border border-line hover:border-accent"
        }`}
      >
        {busy ? "Переходим к оплате…" : "Купить"}
      </button>
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
    </div>
  );
}
