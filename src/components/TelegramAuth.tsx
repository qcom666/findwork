"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConsentChecks } from "./ConsentChecks";

type Widget = Record<string, string | number>;
type TgWindow = Window & { onTelegramAuth?: (user: Widget) => void };

/**
 * Вход и регистрация через Telegram Login Widget. Если аккаунта ещё нет, сервер просит согласия:
 * показываем две отметки и отправляем те же данные виджета повторно.
 * bot: имя бота; null: вход не настроен (в продакшене блок скрывается страницей, локально показываем подсказку).
 */
export function TelegramAuth({ bot, next, hint, title }: { bot: string | null; next: string; hint?: boolean; title: string }) {
  const router = useRouter();
  const holder = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Widget | null>(null);
  const [accept, setAccept] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(auth: Widget, flags: { accept?: boolean; consent?: boolean } = {}) {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auth, ...flags }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.needConsent) {
        setPending(auth);
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Не удалось войти через Telegram");
      router.push(next);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setPending(null);
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
  }, [bot]);

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

      {pending ? (
        <form
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
        <div className="flex min-h-[40px] justify-center" ref={holder} aria-label="Войти через Telegram" />
      )}
      {err && <p className="text-center text-sm text-bad">{err}</p>}
    </div>
  );
}
