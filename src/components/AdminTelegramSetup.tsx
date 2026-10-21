"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminTelegramSetup({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/telegram/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось");
      setMsg({ ok: true, text: `Готово. Telegram будет присылать сообщения на ${data.url}` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button onClick={run} disabled={busy} className="btn btn-primary btn-sm">{busy ? "Подключаю…" : connected ? "Переподключить вебхук" : "Подключить вход через бота"}</button>
      {msg && <p className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </div>
  );
}
