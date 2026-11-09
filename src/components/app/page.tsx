import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  to?: string;
  params?: Record<string, string>;
}

let crumbs: Crumb[] = [];
const subs = new Set<() => void>();
const setCrumbs = (c: Crumb[]) => {
  crumbs = c;
  subs.forEach((s) => s());
};

export function Breadcrumbs() {
  const c = useSyncExternalStore(
    (l) => (subs.add(l), () => void subs.delete(l)),
    () => crumbs,
    () => crumbs,
  );
  return (
    <nav className="flex min-w-0 items-center gap-1 text-[13px]">
      {c.map((x, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />}
          {x.to && i < c.length - 1 ? (
            <Link
              to={x.to as never}
              params={x.params as never}
              className="truncate text-muted-foreground transition-colors hover:text-foreground"
            >
              {x.label}
            </Link>
          ) : (
            <span
              className={cn(
                "truncate",
                i === c.length - 1 ? "font-medium" : "text-muted-foreground",
              )}
            >
              {x.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Page({
  crumbs: c,
  title,
  description,
  actions,
  children,
  className,
  wide,
}: {
  crumbs: Crumb[];
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  const key = JSON.stringify(c);
  useEffect(() => {
    setCrumbs(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "mx-auto w-full px-4 pb-16 pt-6 md:px-8 md:pt-8",
        wide ? "max-w-[1400px]" : "max-w-[1160px]",
        className,
      )}
    >
      {(title || actions) && (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {title && <h1 className="page-title truncate">{title}</h1>}
            {description && (
              <p className="mt-1 max-w-2xl text-[13.5px] text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </motion.div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8 first:mt-0", className)}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <div className="grid size-10 place-items-center rounded-lg border border-border bg-card">
        <Icon className="size-[18px] text-muted-foreground" strokeWidth={1.6} />
      </div>
      <div className="mt-3 text-[13.5px] font-medium">{title}</div>
      <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
