export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="fw-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#10b981" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#fw-g)" />
      <circle cx="14.5" cy="14.5" r="5.5" fill="none" stroke="#fff" strokeWidth="2.6" />
      <path d="M18.8 18.8 24 24" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">FindWork</span>
    </span>
  );
}
