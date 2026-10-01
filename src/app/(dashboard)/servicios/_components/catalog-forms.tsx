import { ActionForm } from "@/components/dashboard/action-form";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { minorToPesosInput } from "@/lib/dashboard/money-input";
import type { PackageTemplate, Service } from "@/lib/schemas/entities";
import { deleteCatalogItemAction, savePackageTemplateAction, saveServiceAction } from "../actions";

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ActiveToggle({ id, defaultChecked }: { id: string; defaultChecked: boolean }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" name="active" defaultChecked={defaultChecked} className="size-4" />
      Activo (Keeper lo ofrece)
    </label>
  );
}

export function ServiceForm({ service }: { service: Service | null }) {
  const p = service?.id ?? "new-service";
  return (
    <ActionForm action={saveServiceAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={service?.id ?? ""} />
      <Field id={`${p}-name`} label="Nombre">
        <Input id={`${p}-name`} name="name" defaultValue={service?.name ?? ""} required maxLength={120} />
      </Field>
      <Field id={`${p}-category`} label="Categoría">
        <Input id={`${p}-category`} name="category" defaultValue={service?.category ?? ""} maxLength={60} placeholder="Facial, Masajes…" />
      </Field>
      <Field id={`${p}-price`} label="Precio (RD$)">
        <Input id={`${p}-price`} name="price" inputMode="decimal" defaultValue={service ? minorToPesosInput(service.priceMinor) : ""} required placeholder="3500" />
      </Field>
      <Field id={`${p}-duration`} label="Duración (minutos)">
        <Input id={`${p}-duration`} name="durationMin" type="number" min={5} max={600} defaultValue={service?.durationMin ?? 60} required />
      </Field>
      <Field id={`${p}-deposit`} label="Anticipo fijo (RD$, opcional)" hint="Vacío = se usa el % de anticipo de Ajustes.">
        <Input
          id={`${p}-deposit`}
          name="depositOverride"
          inputMode="decimal"
          defaultValue={service?.depositOverrideMinor != null ? minorToPesosInput(service.depositOverrideMinor) : ""}
        />
      </Field>
      <div className="flex items-end pb-2">
        <ActiveToggle id={`${p}-active`} defaultChecked={service?.active ?? true} />
      </div>
      <div className="sm:col-span-2">
        <Field id={`${p}-description`} label="Descripción">
          <Textarea id={`${p}-description`} name="description" defaultValue={service?.description ?? ""} rows={2} maxLength={500} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <SubmitButton size="sm">{service ? "Guardar cambios" : "Agregar servicio"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PackageTemplateForm({ template, services }: { template: PackageTemplate | null; services: Service[] }) {
  const p = template?.id ?? "new-package";
  return (
    <ActionForm action={savePackageTemplateAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={template?.id ?? ""} />
      <Field id={`${p}-name`} label="Nombre">
        <Input id={`${p}-name`} name="name" defaultValue={template?.name ?? ""} required maxLength={120} placeholder="Láser piernas · 10 sesiones" />
      </Field>
      <Field id={`${p}-service`} label="Servicio">
        <select
          id={`${p}-service`}
          name="serviceId"
          defaultValue={template?.serviceId ?? ""}
          required
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="" disabled>
            Elige un servicio
          </option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.active ? "" : " (inactivo)"}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${p}-sessions`} label="Sesiones">
        <Input id={`${p}-sessions`} name="sessionsTotal" type="number" min={1} max={100} defaultValue={template?.sessionsTotal ?? 6} required />
      </Field>
      <Field id={`${p}-price`} label="Precio del paquete (RD$)">
        <Input id={`${p}-price`} name="price" inputMode="decimal" defaultValue={template ? minorToPesosInput(template.priceMinor) : ""} required />
      </Field>
      <Field id={`${p}-interval`} label="Cada cuántos días" hint="Intervalo recomendado entre sesiones.">
        <Input id={`${p}-interval`} name="intervalDays" type="number" min={1} max={365} defaultValue={template?.intervalDays ?? 30} required />
      </Field>
      <div className="flex items-end pb-2">
        <ActiveToggle id={`${p}-active`} defaultChecked={template?.active ?? true} />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton size="sm">{template ? "Guardar cambios" : "Crear paquete"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeleteCatalogItem({ id, table }: { id: string; table: "services" | "package_templates" }) {
  return (
    <ActionForm action={deleteCatalogItemAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="table" value={table} />
      <SubmitButton size="sm" variant="destructive" pendingLabel="…">
        Eliminar
      </SubmitButton>
    </ActionForm>
  );
}
