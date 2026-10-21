export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Загрузка">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-surface-2" />
      <div className="flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-8 w-28 animate-pulse rounded-full bg-surface-2" />
        ))}
      </div>
      <div className="card h-28 animate-pulse" />
      <div className="card divide-y divide-line overflow-hidden">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-4">
            <div className="h-11 w-11 animate-pulse rounded-full bg-surface-2" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/5 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
