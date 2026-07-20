import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Circle,
  Info,
} from "lucide-react";

/**
 * Status meaning is always carried by icon + text, never color alone —
 * this app is used by colorblind staff/admins, so hue is a reinforcing
 * signal, not the only one.
 */
const TONES = {
  success: {
    classes:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
    Icon: CheckCircle2,
  },
  danger: {
    classes:
      "bg-rose-50 text-rose-700 ring-1 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20",
    Icon: XCircle,
  },
  warning: {
    classes:
      "bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
    Icon: AlertTriangle,
  },
  info: {
    classes:
      "bg-brand-50 text-brand-700 ring-1 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20",
    Icon: Info,
  },
  pending: {
    classes:
      "bg-slate-100 text-slate-600 ring-1 ring-slate-500/15 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
    Icon: Clock,
  },
  neutral: {
    classes:
      "bg-slate-100 text-slate-600 ring-1 ring-slate-500/15 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
    Icon: Circle,
  },
};

export function Badge({ tone = "neutral", icon = true, className = "", children }) {
  const { classes, Icon } = TONES[tone] || TONES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${classes} ${className}`}
    >
      {icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />}
      {children}
    </span>
  );
}

export default Badge;
