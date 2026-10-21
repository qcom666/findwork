"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConsentChecks } from "./ConsentChecks";

type Widget = Record<string, string | number>;
type TgWindow = Window & { onTelegramAuth?: (user: Widget) => void };
export type MergeSummary = { balance: number; unlocks: number; payments: number; subscriptions: number; reports: number; claims: number };

/**
 * Telegram Login Widget в двух режимах.
 *  login: вход и регистрация. Если аккаунта ещё нет, сервер просит согласия: показываем две отметки и отправляем те же данные виджета повторно.
 *  link: привязка Telegram к аккаунту, в который вы уже вошли. Если этот Telegram заходил отдельно и у него свой аккаунт,
 *        сервер присылает сводку, и мы просим подтвердить объединение.
 * bot: имя бота; null: вход не настроен (в продакшене блок скрывается страницей, локально показываем подсказку).
 */
export function TelegramAuth({ bot, next = "/", hint, title, mode = "login" }: { bot: string | null; next?: string; hint?: boolean; title: string; mode?: "login" | "link" }) {
  const router = useRouter();
  const holder = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Widget | null>(null);
  const [merge, setMerge] = useState<{ auth: Widget; info: MergeSummary } | null>(null);
  const [accept, setAccept] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(auth: Widget, extra: { accept?: boolean; consent?: boolean; confirm?: boolean } = {}) {
    setBusy(true); setErr("");
    try {
      const res = await fetch(mode === "link" ? "/api/auth/telegram/link" : "/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.needConsent) {
        setPending(auth);
        setBusy(false);
        return;
      }
      if (data.needConfirm) {
        setMerge({ auth, info: data.info });
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Не удалось выполнить вход через Telegram");
      if (mode !== "link") router.push(next);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setPending(null);
      setMerge(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    const box = holder.current;
    if (!bot || !box) return;
    (window as TgWindow).onTelegramAuth = (user) => void send(user);
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", bot);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "10");
    s.setAttribute("data-userpic", "false");
    s.setAttribute("data-onauth", "onTelegramAuth(user)");
    box.appendChild(s);
    return () => {
      box.replaceChildren();
      delete (window as TgWindow).onTelegramAuth;
    };
    // send не меняет поведение между рендерами, а перезапуск скрипта сбросил бы виджет
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bot, pending, merge]);

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
            <button disabled={busy} className="btn btn-primary btn-sm" onClick={() => void send(merge.auth, { confirm: true })}>{busy ? "Объединяю…" : "Объединить аккаунты"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMerge(null)}>Отмена</button>
          </div>
        </div>
      ) : pending ? (
        <form
          key="consent"
          onSubmit={(e) => {
            e.preventDefault();
            void send(pending, { accept, consent });
          }}
          className="space-y-3 rounded-xl border border-line bg-surface-2 p-4"
        >
          <p className="text-sm">Аккаунта с этим Telegram ещё нет. Чтобы создать его, подтвердите согласия.</p>
          <ConsentChecks accept={accept} consent={consent} onAccept={setAccept} onConsent={setConsent} />
          <div className="flex gap-2">
            <button disabled={busy || !accept || !consent} className="btn btn-primary btn-sm">{busy ? "Подождите…" : "Создать аккаунт"}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>Отмена</button>
          </div>
        </form>
      ) : (
        // key: без него React переиспользует этот же div под панель подтверждения, а очистка виджета стёрла бы её содержимое
        <div key="widget" className="flex min-h-[40px] justify-center" ref={holder} aria-label={mode === "link" ? "Привязать Telegram" : "Войти через Telegram"} />
      )}
      {err && <p className="text-center text-sm text-bad">{err}</p>}
    </div>
  );
}
