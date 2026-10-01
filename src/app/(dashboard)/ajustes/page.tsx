import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireOwnerContext } from "@/lib/dashboard/context";
import { googleConnectNotice } from "@/lib/dashboard/google-notice";
import type { SearchPageProps } from "@/lib/dashboard/route-props";
import { minorToPesosInput } from "@/lib/dashboard/money-input";
import { formatDayHours, WEEKDAY_LABELS } from "@/lib/dashboard/settings-form";
import { saveSettingsAction } from "./actions";

function NumberField({ name, label, value, hint, min, max }: { name: string; label: string; value: number; hint?: string; min?: number; max?: number }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" defaultValue={value} min={min} max={max} required />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default async function SettingsPage({ searchParams }: SearchPageProps) {
  const ctx = await requireOwnerContext();
  const notice = googleConnectNotice(await searchParams);
  const s = ctx.settings;
  const { business } = ctx;

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes" description={`Moneda ${s.currency} · zona horaria ${s.timezone} · modo ${business.integrationMode === "demo" ? "demo" : "en vivo"}`} />

      <Card>
        <CardHeader>
          <CardTitle>Google Calendar</CardTitle>
          <CardDescription>
            Keeper consulta tu calendario para no ofrecer horarios ocupados y agrega ahí las citas confirmadas.
            {business.googleCalendarId ? ` Calendario actual: ${business.googleCalendarId}.` : " Aún no está conectado."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {notice ? (
            <p
              role="status"
              className={
                notice.tone === "success"
                  ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                  : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              }
            >
              {notice.text}
            </p>
          ) : null}
          <Button asChild variant="outline">
            {/* Plain anchor: the OAuth start route redirects off-site to Google. */}
            <a href="/api/integrations/google/start">Conectar Google Calendar</a>
          </Button>
        </CardContent>
      </Card>

      <ActionForm action={saveSettingsAction} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Negocio y tono</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="businessName">Nombre del negocio</Label>
              <Input id="businessName" name="businessName" defaultValue={business.name} required maxLength={120} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ownerDisplayName">Cómo te presenta Keeper</Label>
              <Input id="ownerDisplayName" name="ownerDisplayName" defaultValue={s.ownerDisplayName} required maxLength={80} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tone">Tono de los mensajes</Label>
              <Textarea id="tone" name="tone" defaultValue={s.tone} rows={2} required maxLength={300} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Anticipo y reservas</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <NumberField name="depositPercent" label="Anticipo (%)" value={s.deposit.percent} min={0} max={100} />
            <div className="space-y-1.5">
              <Label htmlFor="depositMinimum">Anticipo mínimo (RD$)</Label>
              <Input id="depositMinimum" name="depositMinimum" inputMode="decimal" defaultValue={minorToPesosInput(s.deposit.minimumMinor)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="depositRoundTo">Redondear a (RD$)</Label>
              <Input id="depositRoundTo" name="depositRoundTo" inputMode="decimal" defaultValue={minorToPesosInput(s.deposit.roundToMinor)} required />
            </div>
            <NumberField name="holdMinutes" label="Minutos para pagar el anticipo" value={s.holdMinutes} min={5} max={1440} />
            <NumberField name="minLeadMinutes" label="Anticipación mínima (min)" value={s.minLeadMinutes} min={0} />
            <NumberField name="bookingHorizonDays" label="Agenda abierta (días)" value={s.bookingHorizonDays} min={1} max={180} />
            <NumberField name="slotStepMinutes" label="Horarios cada (min)" value={s.slotStepMinutes} min={5} max={120} />
            <NumberField name="bufferMinutes" label="Descanso entre citas (min)" value={s.bufferMinutes} min={0} max={120} />
            <NumberField name="reminderHoursBefore" label="Recordatorio (horas antes)" value={s.reminderHoursBefore} min={1} max={72} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reactivación</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <NumberField name="reactivationWeeks" label="Inactiva después de (semanas)" value={s.reactivationWeeks} min={1} max={52} />
            <NumberField name="reengagementCooldownDays" label="No repetir antes de (días)" value={s.reengagementCooldownDays} min={1} max={90} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Horario</CardTitle>
            <CardDescription>Formato 09:00-18:00. Varios tramos separados por coma (09:00-13:00, 14:00-18:00). Vacío = cerrado.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {WEEKDAY_LABELS.map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`hours_${key}`}>{label}</Label>
                <Input id={`hours_${key}`} name={`hours_${key}`} defaultValue={formatDayHours(s.weeklyHours[key])} placeholder="cerrado" />
              </div>
            ))}
          </CardContent>
        </Card>

        <SubmitButton>Guardar ajustes</SubmitButton>
      </ActionForm>
    </div>
  );
}
