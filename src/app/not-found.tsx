import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-6xl font-bold tracking-tight text-accent">404</p>
      <h1 className="mt-4 text-xl font-semibold">Такой страницы нет</h1>
      <p className="mt-2 text-muted">Возможно, ссылка устарела или заведение пропало из выгрузки.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/leads" className="btn btn-primary">Найти лиды</Link>
        <Link href="/" className="btn btn-ghost">На главную</Link>
      </div>
    </div>
  );
}
