export function GarBar({ green, amber, red }: { green: number; amber: number; red: number }) {
  const total = green + amber + red || 1;
  const segments = [
    { key: "green", count: green, color: "bg-status-green", label: "Green" },
    { key: "amber", count: amber, color: "bg-status-amber", label: "Amber" },
    { key: "red", count: red, color: "bg-status-red", label: "Red" },
  ];

  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
        {segments.map(
          (s) =>
            s.count > 0 && (
              <div
                key={s.key}
                className={s.color}
                style={{ width: `${(s.count / total) * 100}%` }}
                title={`${s.label}: ${s.count}`}
              />
            )
        )}
      </div>
      <div className="mt-3 flex gap-6 text-sm">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-2 text-muted-foreground">
            <span className={`h-2.5 w-2.5 rounded-full ${s.color}`} />
            {s.label} <span className="font-medium text-navy">{s.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
