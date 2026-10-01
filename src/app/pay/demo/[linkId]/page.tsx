import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { isDemoCheckoutExpired, loadDemoCheckout, type DemoCheckoutView } from "@/lib/demo/checkout";
import { SupabaseStore } from "@/lib/store/supabase";
import { PayButton } from "./pay-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pago de anticipo (simulado) · Keeper",
  robots: { index: false, follow: false },
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-zinc-900 first-letter:uppercase">{value}</dd>
    </div>
  );
}

function Summary({ view }: { view: DemoCheckoutView }) {
  return (
    <dl className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 px-4">
      <Row label="Negocio" value={view.businessName} />
      <Row label="Servicio" value={view.serviceName} />
      <Row label="Cita" value={view.appointmentLabel} />
      <Row label="Anticipo" value={view.amountLabel} />
    </dl>
  );
}

function PaidScreen({ view }: { view: DemoCheckoutView }) {
  const confirmed = view.appointmentStatus === "confirmed" || view.appointmentStatus === "completed";
  return (
    <div className="flex flex-col gap-5 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-3xl" aria-hidden>
        ✓
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-zinc-900">{confirmed ? "¡Cita confirmada!" : "Pago recibido"}</h1>
        <p className="text-sm text-zinc-600">
          {confirmed
            ? `Tu anticipo de ${view.amountLabel} quedó registrado. ${view.businessName} te espera.`
            : `Recibimos tu anticipo de ${view.amountLabel}. La dueña te escribirá para confirmar el horario.`}
        </p>
      </div>
      <Summary view={view} />
      <Link
        href={`/chat/${view.businessSlug}`}
        className="flex h-12 items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white hover:bg-zinc-700"
      >
        Volver al chat
      </Link>
    </div>
  );
}

function ExpiredScreen({ view }: { view: DemoCheckoutView }) {
  return (
    <div className="flex flex-col gap-5 text-center">
      <h1 className="text-2xl font-semibold text-zinc-900">Este link venció</h1>
      <p className="text-sm text-zinc-600">
        El horario se liberó porque el anticipo no se pagó a tiempo. Escríbele a Keeper y te aparta otro.
      </p>
      <Link
        href={`/chat/${view.businessSlug}`}
        className="flex h-12 items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white hover:bg-zinc-700"
      >
        Volver al chat
      </Link>
    </div>
  );
}

export default async function DemoCheckoutPage({ params }: PageProps<"/pay/demo/[linkId]">) {
  const { linkId } = await params;
  const env = getServerEnv();
  const view = await loadDemoCheckout(new SupabaseStore(createAdminClient(env)), linkId);
  if (!view) notFound();

  return (
    <main className="flex min-h-dvh flex-1 items-start justify-center bg-zinc-100 px-4 py-10 text-zinc-900 sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-lg">
        <div className="bg-amber-100 px-4 py-2 text-center text-xs font-semibold tracking-wide text-amber-900 uppercase">
          Pago simulado — no se cobra nada
        </div>
        <div className="p-6">
          {view.depositStatus === "paid" ? (
            <PaidScreen view={view} />
          ) : isDemoCheckoutExpired(view, new Date()) ? (
            <ExpiredScreen view={view} />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Checkout seguro de demostración</p>
                <h1 className="text-2xl font-semibold">{view.businessName}</h1>
                <p className="text-sm text-zinc-600">Paga el anticipo para asegurar tu cita. El resto se paga en el local.</p>
              </div>
              <Summary view={view} />
              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
                <p className="font-medium text-zinc-700">Tarjeta de prueba</p>
                <p className="font-mono">4111 1111 1111 1111 · 12/30 · 123</p>
                <p className="mt-1 text-xs">En producción este paso ocurre en la página segura de Azul o Cardnet; Keeper nunca ve la tarjeta.</p>
              </div>
              <PayButton linkId={view.linkId} amountLabel={view.amountLabel} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
