import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { cn } from "@/components/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currentInstant } from "@/lib/dashboard/action-state";
import { STATUS_LABELS } from "@/lib/dashboard/agenda";
import { getClientDetail, type ClientPackageCard } from "@/lib/dashboard/clients-queries";
import { requireOwnerContext } from "@/lib/dashboard/context";
import { formatDate, formatDateTime } from "@/lib/dashboard/format";
import type { IdPageProps } from "@/lib/dashboard/route-props";
import { formatMoney } from "@/lib/domain/money";
import { updateClientAction } from "../actions";

export default async function ClientPage({ params }: IdPageProps) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ctx = await requireOwnerContext();
  const now = currentInstant();
  const detail = await getClientDetail(ctx, id, now);
  if (detail === null) notFound();
  const tz = ctx.settings.timezone;
  const { client, packages, history } = detail;
  const upcoming = history.filter((h) => (h.status === "confirmed" || h.status === "hold_pending_deposit") && new Date(h.startsAt) >= now).reverse();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/clientas" className="text-sm text-muted-foreground hover:underline">
          ← Clientas
        </Link>
      </div>
      <PageHeader
        title={client.name ?? "Clienta sin nombre"}
        description={`${client.phone} · ${detail.lastVisitAt ? `última visita ${formatDate(detail.lastVisitAt, tz)}` : "sin visitas registradas"}`}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Paquetes</CardTitle>
            </CardHeader>
            <CardContent>
              {packages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tiene paquetes.</p>
              ) : (
                <ul className="space-y-3">
                  {packages.map((p) => (
                    <PackageItem key={p.clientPackage.id} pkg={p} timezone={tz} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historial de citas</CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length > 0 ? (
                <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  Próxima cita: {formatDateTime(upcoming[0]!.startsAt, tz)} · {upcoming[0]!.serviceName}
                </p>
              ) : null}
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin citas.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-medium">{h.serviceName}</p>
                        <p className="text-muted-foreground">{formatDateTime(h.startsAt, tz)}</p>
                      </div>
                      <div className="text-right">
                        <p className={cn("text-xs", h.status === "completed" ? "text-emerald-700" : "text-muted-foreground")}>{STATUS_LABELS[h.status]}</p>
                        <p className="text-xs text-muted-foreground">
                          {h.clientPackageId ? "📦 Paquete" : formatMoney(h.priceMinor, ctx.settings.currency)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Contacto y notas</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={updateClientAction} className="space-y-3">
              <input type="hidden" name="clientId" value={client.id} />
              <div className="space-y-1.5">
                <Label htmlFor="name">Nombre</Label>
                <Input id="name" name="name" defaultValue={client.name ?? ""} maxLength={120} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" value={client.phone} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Correo</Label>
                <Input id="email" name="email" type="email" defaultValue={client.email ?? ""} maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notas</Label>
                <Textarea id="notes" name="notes" defaultValue={client.notes ?? ""} rows={4} maxLength={2000} placeholder="Preferencias, alergias…" />
              </div>
              <SubmitButton size="sm">Guardar</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PackageItem({ pkg, timezone }: { pkg: ClientPackageCard; timezone: string }) {
  const { outlook } = pkg;
  const pct = Math.round((outlook.used / outlook.total) * 100);
  return (
    <li className="rounded-lg border p-3" data-testid="client-package">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{pkg.name}</p>
        <p className="text-sm text-muted-foreground">
          {outlook.used} usadas · {outlook.remaining} restantes
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm">
        {outlook.nextLabel === null ? (
          <span className="text-muted-foreground">Paquete terminado ({pkg.clientPackage.status === "completed" ? "completado" : pkg.clientPackage.status}).</span>
        ) : outlook.nextBookedAt ? (
          <>
            Le toca la <strong>{outlook.nextLabel}</strong> — agendada para {formatDateTime(outlook.nextBookedAt, timezone)}.
          </>
        ) : outlook.recommendedAt ? (
          <>
            Le toca la <strong>{outlook.nextLabel}</strong> — recomendada {outlook.overdue ? "desde" : "para"} el {formatDate(outlook.recommendedAt, timezone)}
            {outlook.overdue ? <span className="ml-1 rounded bg-amber-100 px-1.5 text-xs text-amber-900">pendiente de agendar</span> : null}
          </>
        ) : (
          <>
            Le toca la <strong>{outlook.nextLabel}</strong> (cada {pkg.intervalDays} días).
          </>
        )}
      </p>
    </li>
  );
}
