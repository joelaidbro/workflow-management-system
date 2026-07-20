export function Card({ className = "", children, ...props }) {
  return (
    <div
      className={`rounded-2xl border border-slate-900/10 bg-white/80 shadow-sm backdrop-blur-xl dark:border-white/15 dark:bg-slate-900/70 dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_8px_24px_-8px_rgba(0,0,0,0.5)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...props }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-slate-900/8 px-5 py-4 dark:border-white/10 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardBody({ className = "", children, ...props }) {
  return (
    <div className={`p-5 ${className}`} {...props}>
      {children}
    </div>
  );
}

export default Card;
