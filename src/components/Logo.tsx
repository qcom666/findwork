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
      <path d="M16 5.5c-4.4 0-8 3.4-8 7.8 0 5.6 8 13.2 8 13.2s8-7.6 8-13.2c0-4.4-3.6-7.8-8-7.8z" fill="#fff" />
      <circle cx="16" cy="13.2" r="3" fill="#4f46e5" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">Lidomap</span>
    </span>
  );
}
