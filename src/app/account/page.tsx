import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/Small";
import { AutorenewBox } from "@/components/AutorenewBox";
import { CopyField } from "@/components/CopyField";
import { DeleteAccount } from "@/components/DeleteAccount";
import { TelegramLinkBox } from "@/components/TelegramLinkBox";
import { PromoForm } from "@/components/PromoForm";
import { getCurrentUser } from "@/lib/auth";
import { getAutorenewal } from "@/lib/autorenew";
import { listPayments, settlePendingForUser } from "@/lib/billing";
import { getBalance, getLedger, referralReward, SIGNUP_BONUS } from "@/lib/credits";
import { plural } from "@/lib/format";
import { fmtRub } from "@/lib/plans";
import { getLeadsUnlocked } from "@/lib/search";
import { appDb } from "@/lib/db";
import { bonusAvailable } from "@/lib/bonus";
import { activeClaimCount } from "@/lib/claims";
import { getEntitlements } from "@/lib/entitlements";
import { reportQuota } from "@/lib/reports";
import { getSubscriptions } from "@/lib/subscriptions";
import { telegramBotUsername, telegramConfigured } from "@/lib/telegram";
import { siteUrl } from "@/lib/site";
import { getReferralInfo } from "@/lib/users";

export const metadata = { title: "Аккаунт", robots: { index: false, follow: false } };

const STATUS: Record<string, string> = { pending: "ждёт оплаты", succeeded: "оплачен", canceled: "отменён", failed: "ошибка" };
const REASON: Record<string, string> = { signup_bonus: "Бонус за регистрацию", purchase: "Пополнение", subscription: "Кредиты по подписке", exclusive: "Эксклюзив на заведение", report: "Отчёт для клиента", account_deleted: "Аккаунт удалён", unlock: "Открыт лид", promo: "Промокод", referral: "Награда за приглашённого", admin: "Начисление от поддержки" };
const dt = (s: number) => new Date(s * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
const day = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export default async function Account() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account");

  // Если вебхук ЮKassa не дошёл, платёж подтянется при заходе в аккаунт.
  const settled = await settlePendingForUser(user.id).catch(() => 0);
  const balance = settled ? await getBalance(user.id) : user.balance;
  const [payments, ledger, ref, subs, ent, claims, quota, giftOnLink, auto] = await Promise.all([listPayments(user.id, 20), getLedger(user.id, 50), getReferralInfo(user.id), getSubscriptions(user.id), getEntitlements(user.id), activeClaimCount(user.id), reportQuota(user.id), appDb().then((db) => bonusAvailable(db, user.id)), getAutorenewal(user.id)]);
  const paidUntil = subs.length ? Math.max(...subs.map((s) => s.endsAt)) : null;
  // Отключённое автопродление показываем, пока доигрывает оплаченное: потом напоминать о нём незачем
  const showAuto = auto && (auto.status === "active" || (paidUntil != null && auto.canceledAt != null && auto.canceledAt > Date.now() / 1000 - 60 * 86400));
  const reward = referralReward();
  const inviteLink = `${await siteUrl()}/r/${ref.code}`;
  const unlockIds = ledger.filter((l) => l.reason === "unlock" && l.ref).map((l) => l.ref as string);
  const names = new Map((await getLeadsUnlocked(unlockIds)).map((l) => [l.id, l.name]));

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 card p-5">
        <div>
          <p className="text-sm text-muted">{user.label}{user.label !== user.email && <span> · вход через Telegram</span>}</p>
          <p className="mt-1 text-3xl font-semibold">
            {balance} <span className="text-lg font-normal text-muted">{plural(balance, "кредит", "кредита", "кредитов")}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pricing" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90">Пополнить</Link>
          <LogoutButton />
        </div>
      </section>

      <section className="card space-y-2 p-5">
        <h2 className="text-sm font-semibold">Подписка</h2>
        {subs.length === 0 ? (
          <p className="text-sm text-muted">
            Подписки нет. Она дешевле разовых пакетов: кредиты приходят каждый месяц, а продлевать или нет, решаете вы.{" "}
            <Link href="/pricing" className="text-accent hover:underline">Посмотреть тарифы</Link>
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {subs.map((s, i) => (
              <li key={`${s.startsAt}-${i}`}>
                <b>«{s.title}»</b>
                {s.trial ? <>, пробная неделя, {s.creditsPerMonth} {plural(s.creditsPerMonth, "кредит", "кредита", "кредитов")}</> : <>, {s.creditsPerMonth} {plural(s.creditsPerMonth, "кредит", "кредита", "кредитов")} в месяц</>}
                {s.startsAt * 1000 > Date.now() ? <span className="text-muted"> · начнётся {day(s.startsAt)}</span> : <span className="text-muted"> · {s.trial ? "до" : "оплачена до"} {day(s.endsAt)}</span>}
                {s.nextGrantAt && <span className="text-muted"> · следующие кредиты {day(s.nextGrantAt)}</span>}
              </li>
            ))}
          </ul>
        )}
        {showAuto && auto && (
          <AutorenewBox
            active={auto.status === "active"}
            title={auto.title}
            price={fmtRub(auto.priceRub)}
            card={auto.methodTitle}
            next={auto.nextChargeAt ? day(auto.nextChargeAt) : null}
            until={paidUntil ? day(paidUntil) : null}
            canceledOn={auto.canceledAt ? day(auto.canceledAt) : null}
          />
        )}
        {ent.planId && (
          <p className="border-t border-line pt-2 text-sm text-muted">
            Сейчас действует «{ent.planTitle}»: эксклюзивов занято <b className="text-ink">{claims}</b> из {ent.exclusiveSlots}, отчётов клиентам осталось <b className="text-ink">{quota.left}</b> из {ent.reportsPer30d} за 30 дней, докупка кредитов на {ent.packageDiscountPct}% дешевле.
          </p>
        )}
      </section>

      <TelegramLinkBox
        bot={telegramConfigured() ? telegramBotUsername() : null}
        hint={!telegramConfigured() && process.env.NODE_ENV !== "production"}
        linked={user.tgLinked}
        username={user.tgUsername}
        canUnlink={user.hasPassword}
        bonus={giftOnLink ? SIGNUP_BONUS : 0}
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold">Промокод</h2>
        <PromoForm />
      </section>

      {reward > 0 && (
        <section className="card space-y-3 p-5">
          <div>
            <h2 className="text-sm font-semibold">Пригласите коллегу и получите {reward} кредитов</h2>
            <p className="text-sm text-muted">Когда приглашённый впервые купит кредиты, вам начислится {reward}. Награда одна за каждого приглашённого.</p>
          </div>
          <CopyField value={inviteLink} />
          <p className="text-sm text-muted">
            Зарегистрировалось: <b className="text-ink">{ref.invited}</b> · купили: <b className="text-ink">{ref.paid}</b> · заработано кредитов: <b className="text-ink">{ref.earned}</b>
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Платежи</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-muted">Покупок пока не было.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden card text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>{p.title} · {p.amountRub.toLocaleString("ru-RU")} ₽</span>
                <span className="flex items-center gap-3">
                  {p.receiptUrl && <a href={p.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Чек</a>}
                  <span className="text-muted">{STATUS[p.status] ?? p.status} · {dt(p.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">История кредитов</h2>
        <ul className="divide-y divide-line overflow-hidden card text-sm">
          {ledger.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 truncate">
                {REASON[l.reason] ?? l.reason}
                {l.reason === "unlock" && l.ref && (
                  <>: <Link href={`/lead/${encodeURIComponent(l.ref)}`} className="text-accent hover:underline">{names.get(l.ref) ?? "заведение"}</Link></>
                )}
              </span>
              <span className="flex shrink-0 gap-3">
                <span className="text-muted">{dt(l.createdAt)}</span>
                <b className={l.delta > 0 ? "text-good" : ""}>{l.delta > 0 ? `+${l.delta}` : l.delta}</b>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <DeleteAccount hasPassword={user.hasPassword} balance={balance} />
    </div>
  );
}
