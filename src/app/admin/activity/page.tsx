import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { KIND_LABEL, KINDS, ago, getActivity, getActivitySummary, getUserProfile, isKind, type ActivityKind } from "@/lib/activity";
import { getAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Активность", robots: { index: false, follow: false } };

const LIMIT = 100;
const full = (s: number) => new Date(s * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });
const date = (s: number) => new Date(s * 1000).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });

type Q = { user?: number; kind?: ActivityKind; mine?: boolean; before?: number };
function href(q: Q): string {
  const p = new URLSearchParams();
  if (q.user != null) p.set("user", String(q.user));
  if (q.kind) p.set("kind", q.kind);
  if (q.mine) p.set("mine", "1");
  if (q.before != null) p.set("before", String(q.before));
  const s = p.toString();
  return `/admin/activity${s ? `?${s}` : ""}`;
}

export default async function AdminActivity({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getAdmin();
  if (!admin) notFound();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const user = /^\d+$/.test(one("user")) ? Number(one("user")) : undefined;
  const kind = isKind(one("kind")) ? (one("kind") as ActivityKind) : undefined;
  const mine = one("mine") === "1";
  const before = /^\d+$/.test(one("before")) ? Number(one("before")) : undefined;
  const q: Q = { user, kind, mine };

  const [summary, profile, events] = await Promise.all([
    getActivitySummary(),
    user != null ? getUserProfile(user) : null,
    getActivity({ userId: user, kinds: kind ? [kind] : undefined, before, limit: LIMIT, withOwner: mine }),
  ]);
  if (user != null && !profile) notFound();

  return (
    <div className="space-y-6">
      <AdminNav />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Активность</h1>
        <p className="text-sm text-muted">Кто заходил и что делал: регистрации, входы, открытия контактов, оплаты, питчи, статусы лидов и отчёты. Ваши аккаунты в сводке и ленте не учитываются.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Сейчас на сайте" value={summary.online} sub="за последние 5 минут" />
        <Tile label="За сутки" value={summary.day} sub="заходили на сайт" />
        <Tile label="За 7 дней" value={summary.week} sub="заходили на сайт" />
        <Tile label="За 30 дней" value={summary.month} sub="заходили на сайт" />
      </section>
      <p className="-mt-3 text-xs text-muted">
        {summary.trackedSince ? `Время захода записывается с ${date(summary.trackedSince)}: кто не заходил с тех пор, в эти числа не попадает.` : "Время захода начнёт записываться, как только кто-нибудь откроет сайт под своим аккаунтом."}
      </p>

      {profile ? (
        <section className="card space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="break-all text-lg font-semibold">{profile.user} <span className="text-sm font-normal text-muted">№{profile.id}</span></h2>
              <p className="text-xs text-muted">
                {profile.user !== profile.email && !profile.telegram ? `${profile.email} · ` : ""}
                {profile.telegram ? "вход через Telegram · " : ""}с {date(profile.createdAt)}
                {profile.isAdmin && " · это вы"}
                {profile.banned && <span className="text-bad"> · заблокирован</span>}
                {profile.deleted && <span className="text-bad"> · аккаунт удалён</span>}
              </p>
            </div>
            <div className="flex gap-2 text-sm">
              <Link prefetch={false} href={`/admin/users?q=${encodeURIComponent(profile.telegram ? profile.user : profile.email)}`} className="btn btn-ghost btn-sm">В пользователях</Link>
              <Link prefetch={false} href={href({ kind, mine })} className="btn btn-ghost btn-sm">Вся активность</Link>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Последний заход" value={profile.lastSeenAt ? ago(profile.lastSeenAt) : "не записан"} title={profile.lastSeenAt ? full(profile.lastSeenAt) : undefined} />
            <Stat label="Баланс" value={`${profile.balance} кр.`} />
            <Stat label="Оплачено" value={profile.paidRub > 0 ? `${profile.paidRub.toLocaleString("ru-RU")} ₽` : "нет"} />
            <Stat label="Открыто контактов" value={String(profile.unlocks)} />
            <Stat label="Питчей" value={String(profile.pitches)} />
            <Stat label="Отчётов клиентам" value={String(profile.reports)} />
            <Stat label="Приглашено" value={String(profile.referrals)} />
            <Stat label="Открытых сессий" value={String(profile.sessions)} />
          </dl>
          <p className="text-sm">
            {profile.subscriptions.length === 0
              ? <span className="text-muted">Подписки нет.</span>
              : profile.subscriptions.map((s, i) => (
                <span key={i} className="mr-3 inline-block">Подписка <b>«{s.title}»</b> {date(s.startsAt)} – {date(s.endsAt)}, начислено {s.granted} из {s.months} мес.</span>
              ))}
          </p>
        </section>
      ) : (
        summary.top.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Самые активные за 7 дней</h2>
            <ul className="card divide-y divide-line text-sm">
              {summary.top.map((t) => (
                <li key={t.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <Link prefetch={false} href={href({ user: t.userId })} className="min-w-0 break-all font-medium hover:underline">{t.user}</Link>
                  <span className="text-muted">действий: <b className="text-ink">{t.events}</b>{t.lastSeenAt ? ` · последний заход ${ago(t.lastSeenAt)}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link prefetch={false} href={href({ ...q, kind: undefined })} className="chip" aria-current={!kind ? "true" : undefined}>Всё</Link>
          {KINDS.map((k) => (
            <Link prefetch={false} key={k} href={href({ ...q, kind: k })} className="chip" aria-current={kind === k ? "true" : undefined}>{KIND_LABEL[k]}</Link>
          ))}
          {user == null && (
            <Link prefetch={false} href={href({ ...q, mine: !mine })} className="ml-auto text-xs text-muted hover:underline">{mine ? "Скрыть мои аккаунты" : "Показать и мои аккаунты"}</Link>
          )}
        </div>

        <ul className="card divide-y divide-line text-sm">
          {events.length === 0 && <li className="px-4 py-3 text-muted">{before ? "Раньше ничего нет." : "Пока ничего."}</li>}
          {events.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <time className="w-28 shrink-0 text-xs text-muted tabular-nums" title={full(e.at)}>{ago(e.at)}</time>
              {user == null && <Link prefetch={false} href={href({ user: e.userId })} className="min-w-0 break-all font-medium hover:underline">{e.user}</Link>}
              <span className="min-w-0">
                {e.text}
                {e.leadId && <> · <Link prefetch={false} href={`/lead/${e.leadId}`} className="text-accent hover:underline">{e.leadName ?? "заведение"}</Link></>}
              </span>
            </li>
          ))}
        </ul>
        {(before != null || events.length === LIMIT) && (
          <div className="flex gap-3 text-sm">
            {before != null && <Link prefetch={false} href={href(q)} className="btn btn-ghost btn-sm">К новым</Link>}
            {events.length === LIMIT && <Link prefetch={false} href={href({ ...q, before: events[events.length - 1].at })} className="btn btn-ghost btn-sm">Показать раньше</Link>}
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{sub}</p>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold" title={title}>{value}</dd>
    </div>
  );
}
