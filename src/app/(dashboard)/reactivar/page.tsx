import Link from "next/link";
import { z } from "zod";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { currentInstant } from "@/lib/dashboard/action-state";
import { requireOwnerContext, type OwnerContext } from "@/lib/dashboard/context";
import { formatDate } from "@/lib/dashboard/format";
import { reactivationMessage, weeksLabel } from "@/lib/dashboard/reactivation";
import { listReactivationCandidates } from "@/lib/dashboard/reactivation-queries";
import type { SearchPageProps } from "@/lib/dashboard/route-props";
import { reengageAction } from "./actions";

async function sentConfirmation(ctx: OwnerContext, rawId: unknown, repeated: boolean) {
  const id = z.uuid().safeParse(rawId);
  if (!id.success) return null;
  const { data } = await ctx.db.from("clients").select("name").eq("business_id", ctx.business.id).eq("id", id.data).maybeSingle();
  if (!data) return null;
  const name = (data.name as string | null) ?? null;
  return { name: name ?? "la clienta", preview: reactivationMessage(name, ctx.business.name).previewText, repeated };
}

export default async function ReactivationPage({ searchParams }: SearchPageProps) {
  const ctx = await requireOwnerContext();
  const { reactivationWeeks, reengagementCooldownDays, timezone } = ctx.settings;
  const sp = await searchParams;
  const [candidates, sent] = await Promise.all([
    listReactivationCandidates(ctx, currentInstant()),
    sentConfirmation(ctx, sp.enviado, sp.repetido === "1"),
  ]);

  return (
    <div>
      <PageHeader
        title="Reactivar"
        description={`Clientas que no vienen hace ${reactivationWeeks}+ semanas y no tienen cita. No se repite a la misma clienta antes de ${reengagementCooldownDays} días.`}
      />

      {sent ? (
        <div role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="reengage-sent">
          <p>{sent.repeated ? `Ya se le había escrito hoy a ${sent.name}; no se reenvió. Mensaje:` : `Mensaje enviado a ${sent.name}:`}</p>
          <p className="mt-1 rounded bg-white/70 p-2 italic text-foreground">“{sent.preview}”</p>
        </div>
      ) : null}

      <p className="mb-4 text-sm text-muted-foreground">
        {candidates.length} {candidates.length === 1 ? "clienta" : "clientas"} para reenganchar · primero las que llevan más tiempo sin venir.
      </p>

      {candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No hay clientas para reactivar ahora mismo. 🎉</p>
      ) : (
        <ul className="space-y-2" data-testid="reactivation-list">
          {candidates.map((c) => (
            <li key={c.clientId}>
              <Card className="py-3">
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/clientas/${c.clientId}`} className="font-medium hover:underline">
                      {c.name ?? "Clienta sin nombre"}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {c.phone} · última visita {formatDate(c.lastVisitAt, timezone)} (hace {weeksLabel(c.daysSinceVisit)})
                    </p>
                    <details className="mt-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer select-none">Ver mensaje</summary>
                      <p className="mt-1 max-w-md rounded bg-muted p-2 italic">“{c.preview}”</p>
                    </details>
                  </div>
                  <ActionForm action={reengageAction} className="shrink-0">
                    <input type="hidden" name="clientId" value={c.clientId} />
                    <SubmitButton size="sm" pendingLabel="Enviando…">
                      Reenganchar
                    </SubmitButton>
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
