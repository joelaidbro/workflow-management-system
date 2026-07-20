import { useEffect, useState } from "react";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import ThemeToggle from "./ThemeToggle.jsx";
import NotificationCenter from "./NotificationCenter.jsx";

/**
 * Shared app shell: one continuous matte gradient canvas (`.app-mesh-bg`,
 * theme-aware via the `.dark` ancestor selector in index.css) behind a
 * translucent sidebar, header, and content area — cards float on top as
 * glass panels so the gradient reads through the gaps everywhere, not just
 * behind the sidebar.
 */
export default function DashboardShell({
  brand = "WorkFlow",
  logoUrl,
  onLogoError,
  navItems,
  activeSection,
  onSectionChange,
  sectionLabel,
  userName,
  userSubtitle,
  onLogout,
  headerExtra,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [activeSection]);

  const railWidth = collapsed ? "lg:w-20" : "lg:w-64";
  const contentOffset = collapsed ? "lg:pl-20" : "lg:pl-64";

  const NavList = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
      {navItems.map((item) => {
        const isActive = item.id === activeSection;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSectionChange(item.id)}
            title={collapsed ? item.label : undefined}
            className={`focus-ring group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-brand-600 text-white shadow-sm shadow-brand-600/30"
                : "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
            } ${collapsed ? "justify-center" : ""}`}
          >
            <Icon
              className={`h-[18px] w-[18px] shrink-0 ${
                isActive
                  ? "text-white"
                  : "text-slate-400 group-hover:text-slate-700 dark:text-slate-400 dark:group-hover:text-white"
              }`}
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {!!item.badge && (
              <span
                className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ring-2 ${
                  isActive
                    ? "bg-white text-brand-700 ring-brand-600"
                    : "bg-rose-500 text-white ring-slate-50 dark:ring-slate-950"
                } ${collapsed ? "absolute -right-0.5 -top-0.5" : "ml-auto"}`}
              >
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  const SidebarInner = (
    <div className="flex h-full flex-col">
      <div
        className={`flex items-center gap-2.5 px-4 py-5 ${collapsed ? "justify-center" : ""}`}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            onError={onLogoError}
            className="h-8 w-8 shrink-0 rounded-lg bg-white object-contain p-0.5 shadow-sm ring-1 ring-slate-900/15 dark:bg-white/12 dark:shadow-none dark:ring-white/15"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            {brand.charAt(0)}
          </div>
        )}
        {!collapsed && (
          <span className="truncate text-base font-bold tracking-tight text-slate-900 dark:text-white">
            {brand}
          </span>
        )}
      </div>

      {NavList}

      <div className="border-t border-slate-900/8 p-3 dark:border-white/10">
        <button
          type="button"
          onClick={() => setCollapsed((current) => !current)}
          className="focus-ring mb-1 hidden w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white lg:flex"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          ) : (
            <>
              <PanelLeftClose className="h-[18px] w-[18px]" />
              <span>Collapse</span>
            </>
          )}
        </button>

        {!collapsed && (userName || userSubtitle) && (
          <div className="mb-2 px-3 py-1.5">
            {userName && (
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {userName}
              </p>
            )}
            {userSubtitle && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {userSubtitle}
              </p>
            )}
          </div>
        )}

        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            title={collapsed ? "Log out" : undefined}
            className={`focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-rose-500/10 hover:text-rose-600 dark:text-slate-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-300 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <LogOut className="h-[18px] w-[18px]" />
            {!collapsed && <span>Log out</span>}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen">
      <div className="app-mesh-bg" aria-hidden="true" />

      {/* Desktop rail */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden ${railWidth} border-r border-slate-900/8 transition-[width] duration-200 dark:border-white/10 lg:block`}
      >
        {SidebarInner}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white/85 shadow-2xl backdrop-blur-xl dark:bg-slate-950/85">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              className="focus-ring absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-500 hover:bg-slate-900/5 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="h-full">{SidebarInner}</div>
          </div>
        </div>
      )}

      <div className={`flex min-h-screen flex-col ${contentOffset} transition-[padding] duration-200`}>
        <header className="sticky top-0 z-20 flex items-center gap-3 bg-white/30 px-4 py-3.5 shadow-[inset_0_-1px_0_rgba(15,23,42,0.06)] backdrop-blur-xl dark:bg-slate-950/25 dark:shadow-[inset_0_-1px_0_rgba(255,255,255,0.08)] sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="focus-ring rounded-lg p-1.5 text-slate-500 hover:bg-slate-900/5 dark:text-slate-300 dark:hover:bg-white/10 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="truncate text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {sectionLabel}
          </h1>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {headerExtra}
            <NotificationCenter navItems={navItems} onSelect={onSectionChange} />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
