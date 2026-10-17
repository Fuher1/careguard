import { formatCurrency, type Locale } from "../../i18n";

export interface BarProps {
  label: string;
  spent: number;
  budget: number;
  // #1138 — defaults to "en" so existing callers that don't pass a locale
  // render identically to before this change.
  locale?: Locale;
}

export function Bar({ label, spent, budget, locale = "en" }: BarProps) {
  const s = spent ?? 0;
  const b = budget ?? 0;
  const raw = b === 0 ? 0 : (s / b) * 100;
  const pct = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 100) : 0;
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-sky-500";
  const displaySpent = Number.isFinite(s) ? s : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-400">
          {formatCurrency(displaySpent, locale)} / {formatCurrency(b, locale, 0)}
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
