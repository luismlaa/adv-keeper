import Link from "next/link";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { APPROVAL_KIND_LABELS, listPendingApprovals } from "@/lib/dashboard/approvals-queries";
import { requireOwnerContext } from "@/lib/dashboard/context";
import { formatDateTime } from "@/lib/dashboard/format";
import { resolveApprovalAction } from "./actions";

export default async function ApprovalsPage() {
  const ctx = await requireOwnerContext();
  const tz = ctx.settings.timezone;
  const approvals = await listPendingApprovals(ctx);

  return (
    <div>
      <PageHeader
        title="Aprobaciones"
        description="Descuentos, precios fuera de menú, cancelaciones y reembolsos que Keeper no puede decidir sola."
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Aprobar o rechazar solo registra tu decisión: no mueve dinero ni le escribe a la clienta. Avísale tú o pídeselo a Keeper en el chat.
      </p>
      {approvals.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No hay solicitudes pendientes. ✨</p>
      ) : (
        <ul className="space-y-3">
          {approvals.map((a) => (
            <li key={a.id}>
              <Card className="py-3">
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{APPROVAL_KIND_LABELS[a.kind]}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(a.createdAt, tz)}</span>
                  </div>
                  <p className="text-sm">{a.details}</p>
                  <p className="text-sm text-muted-foreground">
                    <Link href={`/clientas/${a.clientId}`} className="font-medium text-foreground hover:underline">
                      {a.clientName}
                    </Link>{" "}
                    · {a.clientPhone}
                    {a.appointmentStartsAt ? ` · cita ${formatDateTime(a.appointmentStartsAt, tz)}${a.appointmentService ? ` (${a.appointmentService})` : ""}` : ""}
                  </p>
                  <ActionForm action={resolveApprovalAction} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input type="hidden" name="approvalId" value={a.id} />
                    <Input name="note" maxLength={500} placeholder="Nota (opcional)" className="h-8 sm:max-w-xs" />
                    <div className="flex gap-2">
                      <SubmitButton size="sm" name="decision" value="approved" pendingLabel="…">
                        Aprobar
                      </SubmitButton>
                      <SubmitButton size="sm" variant="outline" name="decision" value="rejected" pendingLabel="…">
                        Rechazar
                      </SubmitButton>
                    </div>
                  </ActionForm>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
