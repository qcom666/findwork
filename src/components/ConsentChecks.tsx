"use client";

import Link from "next/link";

/** Две отдельные отметки при регистрации: оферта и согласие на обработку персональных данных (152-ФЗ требует отдельного действия). */
export function ConsentChecks({ accept, consent, onAccept, onConsent }: { accept: boolean; consent: boolean; onAccept: (v: boolean) => void; onConsent: (v: boolean) => void }) {
  return (
    <div className="space-y-2 text-xs text-muted">
      <label className="flex items-start gap-2">
        <input type="checkbox" required checked={accept} onChange={(e) => onAccept(e.target.checked)} className="mt-0.5" />
        <span>Принимаю условия <Link href="/terms" target="_blank" className="underline">оферты</Link> и ознакомился с <Link href="/privacy" target="_blank" className="underline">политикой конфиденциальности</Link></span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" required checked={consent} onChange={(e) => onConsent(e.target.checked)} className="mt-0.5" />
        <span>Даю <Link href="/consent" target="_blank" className="underline">согласие на обработку персональных данных</Link></span>
      </label>
    </div>
  );
}
