"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConsentChecks } from "./ConsentChecks";

export type MergeSummary = { balance: number; unlocks: number; payments: number; subscriptions: number; reports: number; claims: number };
/** Запрос входа через бота: одноразовый токен, по которому браузер опрашивает сервер. */
type Src = { token: string };

/**
 * Вход и привязка Telegram через бота: кнопка просит у сервера одноразовую ссылку на бота, человек нажимает Start и
 * «Да, это я» в Telegram, а страница опрашивает сервер и входит сама.
 *  login: вход и регистрация. Если аккаунта ещё нет, сервер просит согласия: показываем две отметки и опрашиваем снова.
 *  link: привязка Telegram к аккаунту, в который вы уже вошли. Если этот Telegram заходил отдельно и у него свой аккаунт,
 *        сервер присылает сводку, и мы просим подтвердить объединение.
 * bot: имя бота; null: вход не настроен (в продакшене блок скрывается страницей, локально показываем подсказку).
 */
export function TelegramAuth({ bot, next = "/", hint, title, mode = "login" }: { bot: string | null; next?: string; hint?: boolean; title: string; mode?: "login" | "link" }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState<Src | null>(null);
  const [merge, setMerge] = useState<{ src: Src; info: MergeSummary } | null>(null);
  const [botFlow, setBotFlow] = useState<{ token: string; url: string; ttl: number } | null>(null);
  const [accept, setAccept] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function reset(message = "") {
    setErr(message); setPending(null); setMerge(null); setBotFlow(null); setBusy(false);
  }

  /** silent: фоновый опрос бота, без индикатора занятости. */
  async function call(src: Src, extra: { accept?: boolean; consent?: boolean; confirm?: boolean } = {}, silent = false) {
    if (silent && inFlight.current) return;
    inFlight.current = true;
    if (!silent) { setBusy(true); setErr(""); }
    try {
      const res = await fetch("/api/auth/telegram/bot/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: src.token, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.status === "waiting") return;
      if (data.status === "expired") return reset("Время запроса вышло. Начните заново.");
      if (data.status === "denied") return reset("Вход отклонён в Telegram.");
      if (data.needConsent || data.status === "needConsent") { setPending(src); setBusy(false); return; }
      if (data.needConfirm || data.status === "needConfirm") { setMerge({ src, info: data.info }); setBusy(false); return; }
      if (!res.ok) throw new Error(data.error ?? "Не удалось выполнить вход через Telegram");
      if (mode !== "link") router.push(next);
      router.refresh();
    } catch (e) {
      reset((e as Error).message);
    } finally {
      inFlight.current = false;
    }
  }

  async function startBot() {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth/telegram/bot/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не удалось начать вход через бота");
      setBotFlow(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Вход через бота: пока человек подтверждает в Telegram, раз в две секунды спрашиваем сервер.
  useEffect(() => {
    if (!botFlow || pending || merge) return;
    const poll = setInterval(() => void call({ token: botFlow.token }, {}, true), 2000);
    const stop = setTimeout(() => reset("Время запроса вышло. Начните заново."), botFlow.ttl * 1000);
    return () => { clearInterval(poll); clearTimeout(stop); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botFlow, pending, merge]);

  if (!bot) {
    return hint ? (
      <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
        Вход через Telegram появится после настройки бота: задайте TELEGRAM_BOT_USERNAME и TELEGRAM_BOT_TOKEN (docs/LAUNCH-CHECKLIST.md). Это сообщение видно только в разработке.
      </p>
    ) : null;
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-muted">{title}</p>

      {merge ? (
        <div key="merge" className="space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
          <p>Этот Telegram уже заходил на сайт отдельно, и у него есть свой аккаунт:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            <li>кредитов: <b className="text-ink">{merge.info.balance}</b></li>
            <li>открытых заведений: <b className="text-ink">{merge.info.unlocks}</b></li>
            {merge.info.payments > 0 && <li>оплат: <b className="text-ink">{merge.info.payments}</b></li>}
            {merge.info.subscriptions > 0 && <li>подписок: <b className="text-ink">{merge.info.subscriptions}</b></li>}
            {merge.info.reports > 0 && <li>отчётов клиентам: <b className="text-ink">{merge.info.reports}</b></li>}
          </ul>
          <p className="text-muted">Всё это перейдёт в текущий аккаунт, а отдельный Telegram-аккаунт перестанет существовать. Отменить это нельзя.</p>
          <div className="flex gap-2">
            <button disabled={busy} className="btn btn-primary btn-sm" onClick={() => void call(merge.src, { confirm: true })}>{busy ? "Объединяю…" : "Объединить аккаунты"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset()}>Отмена</button>
          </div>
        </div>
      ) : pending ? (
        <form
          key="consent"
          onSubmit={(e) => {
            e.preventDefault();
            void call(pending, { accept, consent });
          }}
          className="space-y-3 rounded-xl border border-line bg-surface-2 p-4"
        >
          <p className="text-sm">Аккаунта с этим Telegram ещё нет. Чтобы создать его, подтвердите согласия.</p>
          <ConsentChecks accept={accept} consent={consent} onAccept={setAccept} onConsent={setConsent} />
          <div className="flex gap-2">
            <button disabled={busy || !accept || !consent} className="btn btn-primary btn-sm">{busy ? "Подождите…" : "Создать аккаунт"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset()}>Отмена</button>
          </div>
        </form>
      ) : botFlow ? (
        <div key="bot" className="space-y-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Откройте бота в Telegram: <a href={botFlow.url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">@{bot}</a>.</li>
            <li>Нажмите <b>Start</b>, затем <b>«Да, это я»</b>.</li>
            <li>Вернитесь сюда: страница обновится сама.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <a href={botFlow.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">Открыть бота</a>
            <span className="text-xs text-muted">Ждём подтверждения…</span>
            <button type="button" className="text-xs text-muted hover:text-ink hover:underline" onClick={() => reset()}>Отмена</button>
          </div>
        </div>
      ) : (
        <button key="start" type="button" onClick={() => void startBot()} disabled={busy} className="btn btn-primary w-full">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M9.78 18.65l.28-4.23 7.68-6.93c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" /></svg>
          {busy ? "Готовим ссылку…" : mode === "link" ? "Привязать Telegram" : "Войти через Telegram"}
        </button>
      )}
      {err && <p className="text-center text-sm text-bad">{err}</p>}
    </div>
  );
}
