"use client";

import { useState } from "react";

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка-приглашение" className="field" />
      <button
        className="btn btn-ghost shrink-0"
        onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
        }}
      >
        {copied ? "Скопировано" : "Копировать"}
      </button>
    </div>
  );
}
