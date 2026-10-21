"use client";

import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";

/**
 * Форма фильтров, которая применяется сразу при смене выбора, без кнопки.
 * Поля рисует сервер, а здесь только сбор значений в адрес страницы, так что ссылку на выдачу можно отправить другому.
 */
export function FilterForm({ action, children }: { action: string; children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();

  function submit() {
    const fd = new FormData(ref.current!);
    const q = new URLSearchParams();
    // Значения по умолчанию в адрес не кладём: ссылки на выдачу остаются короткими.
    const DEFAULTS: Record<string, string> = { site: "need", sort: "score", min: "0" };
    for (const [k, v] of fd.entries()) if (typeof v === "string" && v !== "" && DEFAULTS[k] !== v) q.set(k, v);
    start(() => router.push(`${action}?${q.toString()}`));
  }

  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onChange={(e) => {
        // Текст отправляем по Enter, остальное сразу.
        if (e.target instanceof HTMLInputElement && e.target.type === "search") return;
        submit();
      }}
      aria-busy={pending}
      className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}
    >
      {children}
    </form>
  );
}
