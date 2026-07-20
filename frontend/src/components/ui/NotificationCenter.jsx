import { useEffect, useRef, useState } from "react";
import { Bell, BellOff } from "lucide-react";

/**
 * Aggregates the badge counts already carried by navItems into one dropdown,
 * instead of making the user hunt across sidebar badges to see what's new.
 * Deliberately reads off navItems rather than taking its own data — every
 * dashboard already computes those badge counts for the sidebar, so this
 * needs no extra wiring per page.
 */
export default function NotificationCenter({ navItems, onSelect }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const items = navItems.filter((item) => item.badge > 0);
  const total = items.reduce((sum, item) => sum + item.badge, 0);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={total > 0 ? `${total} unread notifications` : "Notifications"}
        aria-expanded={open}
        className="focus-ring relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white"
      >
        <Bell className="h-4.5 w-4.5" />
        {total > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-slate-50 dark:ring-slate-950">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-slate-900/10 bg-white/95 shadow-xl backdrop-blur-xl dark:border-white/15 dark:bg-slate-900/95">
          <div className="border-b border-slate-100 px-4 py-3 dark:border-white/5">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Notifications</h3>
          </div>
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <BellOff className="h-5 w-5 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-400">You're all caught up</p>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(item.id);
                        setOpen(false);
                      }}
                      className="focus-ring flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                    >
                      {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" />}
                      <span className="flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
                        {item.label}
                      </span>
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
