import { PageHeader } from "@/components/dashboard/page-header";
import { cn } from "@/components/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listPackageTemplates, listServices } from "@/lib/dashboard/catalog-queries";
import { requireOwnerContext } from "@/lib/dashboard/context";
import { formatMoney } from "@/lib/domain/money";
import { DeleteCatalogItem, PackageTemplateForm, ServiceForm } from "./_components/catalog-forms";

export default async function ServicesPage() {
  const ctx = await requireOwnerContext();
  const [services, templates] = await Promise.all([listServices(ctx), listPackageTemplates(ctx)]);
  const currency = ctx.settings.currency;
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Servicios" description="El catálogo es la única fuente de precios: Keeper nunca inventa ni negocia montos." />

      <Card>
        <CardHeader>
          <CardTitle>Servicios ({services.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {services.map((s) => (
            <details key={s.id} className={cn("rounded-lg border px-3 py-2", !s.active && "opacity-60")}>
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {s.name}
                  {s.active ? null : <span className="ml-2 text-xs text-muted-foreground">(inactivo)</span>}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatMoney(s.priceMinor, currency)} · {s.durationMin} min · {s.category}
                </span>
              </summary>
              <div className="mt-3 space-y-3 border-t pt-3">
                <ServiceForm service={s} />
                <DeleteCatalogItem id={s.id} table="services" />
              </div>
            </details>
          ))}
          <details className="rounded-lg border border-dashed px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">+ Agregar servicio</summary>
            <div className="mt-3 border-t pt-3">
              <ServiceForm service={null} />
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paquetes ({templates.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {templates.map((t) => (
            <details key={t.id} className={cn("rounded-lg border px-3 py-2", !t.active && "opacity-60")}>
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {t.name}
                  {t.active ? null : <span className="ml-2 text-xs text-muted-foreground">(inactivo)</span>}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatMoney(t.priceMinor, currency)} · {t.sessionsTotal} sesiones · cada {t.intervalDays} días · {serviceName.get(t.serviceId) ?? ""}
                </span>
              </summary>
              <div className="mt-3 space-y-3 border-t pt-3">
                <PackageTemplateForm template={t} services={services} />
                <DeleteCatalogItem id={t.id} table="package_templates" />
              </div>
            </details>
          ))}
          <details className="rounded-lg border border-dashed px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">+ Crear paquete</summary>
            <div className="mt-3 border-t pt-3">
              <PackageTemplateForm template={null} services={services.filter((s) => s.active)} />
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
