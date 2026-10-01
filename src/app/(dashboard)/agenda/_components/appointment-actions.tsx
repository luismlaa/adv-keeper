"use client";

import { ActionForm } from "@/components/dashboard/action-form";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { ownerAppointmentAction } from "../actions";

type OwnerAction = "complete" | "no_show" | "cancel";

export function AppointmentActions({ appointmentId, actions }: { appointmentId: string; actions: OwnerAction[] }) {
  if (actions.length === 0) return null;
  const quick = actions.filter((a) => a !== "cancel");
  return (
    <div className="flex flex-col gap-2">
      {quick.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {quick.map((action) => (
            <ActionForm key={action} action={ownerAppointmentAction}>
              <input type="hidden" name="appointmentId" value={appointmentId} />
              <input type="hidden" name="action" value={action} />
              <SubmitButton size="sm" variant={action === "complete" ? "default" : "outline"} pendingLabel="…">
                {action === "complete" ? "✓ Completada" : "No vino"}
              </SubmitButton>
            </ActionForm>
          ))}
        </div>
      ) : null}
      {actions.includes("cancel") ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">Cancelar cita…</summary>
          <ActionForm action={ownerAppointmentAction} className="mt-2 space-y-2">
            <input type="hidden" name="appointmentId" value={appointmentId} />
            <input type="hidden" name="action" value="cancel" />
            <Textarea name="reason" rows={2} maxLength={500} placeholder="Motivo (opcional): ej. la clienta pidió reprogramar" />
            <SubmitButton size="sm" variant="destructive" pendingLabel="Cancelando…">
              Confirmar cancelación
            </SubmitButton>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}
