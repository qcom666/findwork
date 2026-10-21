"use client";

import { useRef, useState } from "react";

type Status = { id: string; label: string };

/** Этап работы с лидом и заметка. Сохраняется сразу, без кнопки. */
export function LeadCrm({ leadId, statuses, status: initial, note: initialNote }: { leadId: string; statuses: Status[]; status: string; note: string }) {
  const [status, setStatus] = useState(initial);
  const [note, setNote] = useState(initialNote);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastNote = useRef(initialNote);

  async function save(patch: { status?: string; note?: string }) {
    setState("saving");
    try {
      const res = await fetch("/api/leads/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, ...patch }),
      });
      if (!res.ok) throw new Error();
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Работа с лидом</h2>
        <span className="text-xs text-muted" aria-live="polite">
          {state === "saving" ? "Сохраняю…" : state === "saved" ? "Сохранено" : state === "error" ? "Не удалось сохранить" : ""}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Этап">
        {statuses.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={status === s.id}
            data-on={status === s.id}
            className="chip"
            onClick={() => {
              setStatus(s.id);
              save({ status: s.id });
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== lastNote.current) {
            lastNote.current = note;
            save({ note });
          }
        }}
        maxLength={1000}
        rows={3}
        placeholder="Заметка: о чём договорились, когда написать снова"
        className="field mt-3 resize-y"
      />
    </section>
  );
}
