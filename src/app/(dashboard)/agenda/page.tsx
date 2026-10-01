import Link from "next/link";
import { DepositBadge } from "@/components/dashboard/deposit-badge";
import { PageHeader } from "@/components/dashboard/page-header";
import { cn } from "@/components/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { currentInstant } from "@/lib/dashboard/action-state";
import { agendaNeighbours, agendaRange, groupByLocalDay, parseAgendaParams, STATUS_LABELS, type AgendaView } from "@/lib/dashboard/agenda";
import { listAgenda, type AgendaItem } from "@/lib/dashboard/agenda-queries";
import { requireOwnerContext } from "@/lib/dashboard/context";
import type { SearchPageProps } from "@/lib/dashboard/route-props";
import { formatDayHeading, formatTime, isoDayOf, localIsoDay } from "@/lib/dashboard/format";
import { formatMoney } from "@/lib/domain/money";
import { AppointmentActions } from "./_components/appointment-actions";

export default async function AgendaPage({ searchParams }: SearchPageProps) {
  const ctx = await requireOwnerContext();
  const tz = ctx.settings.timezone;
  const now = currentInstant();
  const { view, anchor } = parseAgendaParams(await searchParams, now, tz);
  const range = agendaRange(view, anchor, tz);
  const items = await listAgenda(ctx, range.from, range.to);
  const groups = groupByLocalDay(items, range.days, tz);
  const { prev, next } = agendaNeighbours(view, anchor, tz);
  const today = localIsoDay(now, tz);
  const href = (v: AgendaView, date: string) => `/agenda?view=${v}&date=${date}`;

  const live = items.filter((i) => i.status !== "cancelled");
  const pendingCount = live.filter((i) => i.badge.kind === "pending").length;
  const first = range.days[0]!;
  const last = range.days[range.days.length - 1]!;

  return (
    <div>
      <PageHeader
        title="Agenda"
        description={view === "day" ? formatDayHeading(anchor) : `Semana del ${formatDayHeading(first)} al ${formatDayHeading(last)}`}
      >
        <div className="inline-flex rounded-lg border bg-background p-0.5">
          {(["day", "week"] as const).map((v) => (
            <Link
              key={v}
              href={href(v, isoDayOf(anchor))}
              aria-current={v === view ? "page" : undefined}
              className={cn("rounded-md px-3 py-1 text-sm", v === view ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              {v === "day" ? "Día" : "Semana"}
            </Link>
          ))}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={href(view, prev)} aria-label="Anterior">
            ←
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={href(view, today)}>Hoy</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={href(view, next)} aria-label="Siguiente">
            →
          </Link>
        </Button>
      </PageHeader>

      <p className="mb-4 text-sm text-muted-foreground">
        {live.length} {live.length === 1 ? "cita" : "citas"}
        {pendingCount > 0 ? ` · ${pendingCount} con anticipo pendiente` : ""} · hora de {tz.replace(/_/g, " ")}
      </p>

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.iso} aria-labelledby={`day-${group.iso}`}>
            <h2 id={`day-${group.iso}`} className="mb-2 flex items-center gap-2 text-sm font-semibold first-letter:uppercase">
              {view === "week" ? (
                <Link href={href("day", group.iso)} className="hover:underline">
                  {formatDayHeading(group.day)}
                </Link>
              ) : (
                formatDayHeading(group.day)
              )}
              {group.iso === today ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">hoy</span> : null}
            </h2>
            {group.items.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">Sin citas.</p>
            ) : (
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <AppointmentCard item={item} timezone={tz} currency={ctx.settings.currency} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function AppointmentCard({ item, timezone, currency }: { item: AgendaItem; timezone: string; currency: string }) {
  const muted = item.status === "cancelled" || item.status === "no_show";
  return (
    <Card className={cn("py-3", muted && "opacity-60")} data-testid="appointment">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="w-20 shrink-0 text-sm font-semibold tabular-nums">
            {formatTime(item.startsAt, timezone)}
            <div className="text-xs font-normal text-muted-foreground">{formatTime(item.endsAt, timezone)}</div>
          </div>
          <div className="min-w-0 space-y-1">
            <Link href={`/clientas/${item.clientId}`} className="font-medium hover:underline">
              {item.clientName}
            </Link>
            <p className="text-sm text-muted-foreground">
              {item.serviceName}
              {item.priceMinor > 0 ? ` · ${formatMoney(item.priceMinor, currency)}` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <DepositBadge badge={item.badge} />
              <span className="text-xs text-muted-foreground">{STATUS_LABELS[item.status]}</span>
            </div>
          </div>
        </div>
        <div className="sm:max-w-64">
          <AppointmentActions appointmentId={item.id} actions={item.actions} />
        </div>
      </CardContent>
    </Card>
  );
}
