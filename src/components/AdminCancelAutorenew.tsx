"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Отключить автопродление пользователю из админки: оплаченное доигрывает, новых списаний нет. */
export function AdminCancelAutorenew({ userId }: { userId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function cancel() {
    if (!confirm("Отключить автопродление? Новых списаний не будет, оплаченное доработает до конца срока.")) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/admin/users/autorenew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
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
      <button type="button" onClick={cancel} disabled={busy} className="ml-2 text-xs text-bad underline-offset-2 hover:underline">{busy ? "…" : "отключить"}</button>
      {err && <span className="ml-2 text-xs text-bad">{err}</span>}
    </>
  );
}
