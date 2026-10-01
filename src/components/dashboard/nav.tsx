"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/lib/utils";

export const DASHBOARD_LINKS = [
  { href: "/agenda", label: "Agenda" },
  { href: "/clientas", label: "Clientas" },
  { href: "/reactivar", label: "Reactivar" },
  { href: "/aprobaciones", label: "Aprobaciones" },
  { href: "/servicios", label: "Servicios" },
  { href: "/ajustes", label: "Ajustes" },
] as const;

/** Horizontal, scrollable on phones; highlights the current section. */
export function DashboardNav({ pendingApprovals }: { pendingApprovals: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1">
        {DASHBOARD_LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {link.label}
                {link.href === "/aprobaciones" && pendingApprovals > 0 ? (
                  <span className="rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">{pendingApprovals}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
