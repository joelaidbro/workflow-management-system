export default function TabBar({ tabs, activeId, onChange, className = "" }) {
  return (
    <div
      role="tablist"
      className={`inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/5 ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`focus-ring relative flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${
              isActive
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
            {!!tab.badge && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-slate-100 dark:ring-white/5">
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
