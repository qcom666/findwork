import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { AdminNav } from "@/components/AdminNav";
import { AdminTelegramSetup } from "@/components/AdminTelegramSetup";
import { getAdmin } from "@/lib/admin";
import { telegramBotUsername } from "@/lib/telegram";
import { botConfigured, tgApi } from "@/lib/telegram-bot";

export const metadata: Metadata = { title: "Telegram", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Me = { id: number; username?: string; first_name?: string };
type Hook = { url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string };

const dt = (s: number) => new Date(s * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

/** Проверка бота для входа через Telegram: токен принят, имя совпадает, вебхук подключён. Сам токен нигде не показывается. */
export default async function AdminTelegram() {
  if (!(await getAdmin())) notFound();
  const configured = botConfigured();
  let me: Me | null = null, hook: Hook | null = null, error = "";
  if (configured) {
    try {
      [me, hook] = await Promise.all([tgApi<Me>("getMe"), tgApi<Hook>("getWebhookInfo")]);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const expected = `${process.env.APP_URL?.replace(/\/$/, "") || `https://${host}`}/api/telegram/webhook`;
  const nameOk = !!me?.username && me.username.toLowerCase() === (telegramBotUsername() ?? "").toLowerCase();
  const hookOk = !!hook?.url && hook.url === expected;

  return (
    <div className="space-y-6">
      <AdminNav />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Telegram</h1>
        <p className="text-sm text-muted">Бот для входа и регистрации. Кнопка в окне Telegram и вход через бота (ссылка и «Start») работают независимо друг от друга.</p>
      </div>

      <ul className="card divide-y divide-line text-sm">
        <Row ok={configured} title="Переменные окружения" text={configured ? `TELEGRAM_BOT_USERNAME = @${telegramBotUsername()}, токен задан` : "Не заданы TELEGRAM_BOT_USERNAME и TELEGRAM_BOT_TOKEN"} />
        <Row ok={!!me} title="Токен принят Telegram" text={me ? `Бот @${me.username} (id ${me.id})` : error || "Проверка не выполнялась"} />
        <Row ok={nameOk} title="Имя бота совпадает с TELEGRAM_BOT_USERNAME" text={nameOk ? "Да" : me ? `Токен от @${me.username}, а в настройках @${telegramBotUsername()}: токен и имя от разных ботов` : "Нет данных"} />
        <Row ok={hookOk} title="Вебхук для входа через бота" text={hook?.url ? `${hook.url}${hookOk ? "" : ` (ожидали ${expected})`}` : "Не подключён"} />
        {hook?.last_error_message && <Row ok={false} title="Последняя ошибка вебхука" text={`${hook.last_error_message}${hook.last_error_date ? `, ${dt(hook.last_error_date)}` : ""}`} />}
        {typeof hook?.pending_update_count === "number" && hook.pending_update_count > 0 && <Row ok={false} title="Не доставлено обновлений" text={String(hook.pending_update_count)} />}
      </ul>

      {configured && <AdminTelegramSetup connected={hookOk} />}
      <p className="text-xs text-muted">Вебхук подключается одним нажатием: токен остаётся на сервере. Если токен не принят, перезапишите его командой <code>vercel env add TELEGRAM_BOT_TOKEN production</code> и передеплойте.</p>
    </div>
  );
}

function Row({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-good" : "bg-bad"}`} aria-hidden="true" />
      <span className="min-w-0"><b>{title}</b><span className="block break-words text-muted">{text}</span></span>
    </li>
  );
}
