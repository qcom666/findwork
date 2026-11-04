"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Автопродление в «Аккаунте». Даты приходят с сервера уже подписанными, чтобы не зависеть от часового пояса браузера.
 * Отключение — ссылка с подтверждением: одно нажатие, и карта больше не используется (раздел 16 оферты).
 */
export function AutorenewBox({ active, title, price, card, next, until, canceledOn }: {
  active: boolean; title: string; price: string; card: string | null;
  /** Когда следующее списание (если включено) */ next: string | null;
  /** До какого числа действует оплаченное */ until: string | null;
  /** Когда отключили (если выключено) */ canceledOn: string | null;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function cancel() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/billing/autorenew", { method: "POST" });
      if (!res.ok) throw new Error("Не получилось, попробуйте ещё раз или напишите в поддержку");
      setAsking(false);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return (
      <div id="autorenew" className="scroll-mt-24 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-muted">
        Автопродление «{title}» отключено{canceledOn ? ` (${canceledOn})` : ""}. {until ? `Оплаченное действует до ${until}, дальше без списаний.` : "Списаний больше не будет."}
      </div>
    );
  }

  return (
    <div id="autorenew" className="scroll-mt-24 rounded-lg border border-line bg-surface-2 p-3 text-sm">
      <p className="flex items-start gap-2">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-good" aria-hidden="true" />
        <span>
          <b>Автопродление «{title}» включено.</b>{" "}
          <span className="text-muted">
            Следующее списание {next} — {price}{card ? ` с карты ${card}` : " с сохранённой карты"}. За сутки до него пришлём напоминание в Telegram.
          </span>
        </span>
      </p>
      {!asking ? (
        <button type="button" onClick={() => setAsking(true)} className="mt-2 pl-4 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          Отключить автопродление
        </button>
      ) : (
        <div className="mt-3 rounded-lg bg-surface p-3">
          <p className="text-sm">Отключить? Подписка доработает{until ? ` до ${until}` : ""} и не продлится, карта больше не будет использоваться. Кредиты на балансе останутся.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={cancel} disabled={busy} className="btn btn-ghost btn-sm">{busy ? "…" : "Отключить"}</button>
            <button type="button" onClick={() => setAsking(false)} className="btn btn-primary btn-sm">Оставить</button>
          </div>
          {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        </div>
      )}
    </div>
  );
}
