"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TelegramAuth } from "./TelegramAuth";

/**
 * Блок «Telegram» в аккаунте. Аккаунт с почтой может привязать Telegram, чтобы входить в один клик и не заводить второй аккаунт;
 * привязанный можно отвязать. Аккаунту, созданному через Telegram, отвязывать нечего: это его единственный вход.
 */
export function TelegramLinkBox({ bot, hint, linked, username, canUnlink }: { bot: string | null; hint: boolean; linked: boolean; username: string | null; canUnlink: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function unlink() {
    if (!confirm("Отвязать Telegram? Входить через него больше не получится, а при новом входе создастся отдельный аккаунт.")) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth/telegram/unlink", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось отвязать");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!linked && !bot && !hint) return null;

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-sm font-semibold">Telegram</h2>
      {linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted">
            Привязан{username ? <> <b className="text-ink">@{username}</b></> : ""}. Вход через Telegram ведёт в этот аккаунт{canUnlink ? "" : ": это единственный способ входа"}.
          </p>
          {canUnlink && <button onClick={unlink} disabled={busy} className="btn btn-ghost btn-sm">{busy ? "…" : "Отвязать"}</button>}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            Привяжите Telegram, чтобы входить в один клик. Если вы уже заходили через Telegram отдельно, аккаунты объединятся: кредиты, открытые заведения и платежи окажутся здесь.
          </p>
          <TelegramAuth bot={bot} hint={hint} mode="link" title="Подтвердите вход через Telegram" />
        </>
      )}
      {err && <p className="text-sm text-bad">{err}</p>}
    </section>
  );
}
