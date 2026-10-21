"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Что-то пошло не так</h1>
      <p className="mt-2 text-muted">Мы уже в курсе. Попробуйте обновить страницу, а если не поможет, вернитесь позже.</p>
      <div className="mt-6 flex justify-center gap-2">
        <button onClick={reset} className="btn btn-primary">Повторить</button>
        <Link href="/" className="btn btn-ghost">На главную</Link>
      </div>
    </div>
  );
}
