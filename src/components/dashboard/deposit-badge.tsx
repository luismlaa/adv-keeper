import { cn } from "@/components/lib/utils";
import type { DepositBadge as Badge } from "@/lib/dashboard/agenda";

const STYLES: Readonly<Record<Badge["kind"], string>> = {
  paid: "bg-emerald-100 text-emerald-900",
  pending: "bg-amber-100 text-amber-900",
  package: "bg-violet-100 text-violet-900",
  expired: "bg-zinc-200 text-zinc-700",
  refunded: "bg-sky-100 text-sky-900",
  none: "bg-zinc-100 text-zinc-700",
};

export function DepositBadge({ badge }: { badge: Badge }) {
  return (
    <span
      data-kind={badge.kind}
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STYLES[badge.kind])}
    >
      {badge.label}
    </span>
  );
}
