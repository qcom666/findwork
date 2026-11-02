"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Снять подаренную подписку: права пропадают сразу, начисленные кредиты остаются. */
export function AdminRevokeGift({ userId }: { userId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function revoke() {
    if (!confirm("Снять подаренную подписку? Права тарифа пропадут сразу, следующие месяцы не придут. Начисленные кредиты останутся.")) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/users/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, revoke: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={revoke} disabled={busy} className="ml-2 text-xs text-bad underline-offset-2 hover:underline">{busy ? "…" : "снять подарок"}</button>
      {err && <span className="ml-2 text-xs text-bad">{err}</span>}
    </>
  );
}
