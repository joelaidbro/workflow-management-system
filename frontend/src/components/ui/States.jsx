import { Loader2, Inbox } from "lucide-react";

export function LoadingState({ label = "Loading…" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-48 flex-col items-center justify-center gap-3 text-slate-400 dark:text-slate-500"
    >
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title = "Nothing here yet",
  description,
  action,
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 px-6 py-10 text-center dark:border-white/10">
      <Icon className="h-8 w-8 text-slate-300 dark:text-slate-600" />
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
        {title}
      </p>
      {description && (
        <p className="max-w-sm text-sm text-slate-400 dark:text-slate-500">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
