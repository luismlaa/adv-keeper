import type { Metadata } from "next";
import Link from "next/link";
import { getServerEnv } from "@/lib/config/env";
import { OwnerButton } from "./owner-button";

// Reads server env (demo slug) at request time rather than baking it in at build.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Prueba Keeper · demo",
  description: "Prueba Keeper como clienta o como dueña de un spa de demostración.",
};

export default function DemoPage() {
  const slug = getServerEnv().DEMO_BUSINESS_SLUG;
  return (
    <main className="flex flex-1 flex-col items-center bg-rose-50/60 px-4 py-12 text-zinc-900">
      <div className="flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2 text-center">
          <Link href="/" className="text-sm font-semibold tracking-wide text-rose-700">
            Keeper
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Prueba Keeper en un spa de demostración</h1>
          <p className="text-zinc-600">Elige cómo quieres verlo. Puedes abrir las dos vistas en pestañas distintas.</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-3xl" aria-hidden>
              💬
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <h2 className="text-xl font-semibold">Soy la clienta</h2>
              <p className="text-sm text-zinc-600">
                Escríbele al spa como lo harías por WhatsApp: pregunta precios, pide un horario y paga el anticipo en el checkout simulado.
              </p>
            </div>
            <Link
              href={`/chat/${slug}`}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-rose-600 text-base font-semibold text-white transition-colors hover:bg-rose-700"
            >
              Abrir el chat
            </Link>
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-3xl" aria-hidden>
              📅
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <h2 className="text-xl font-semibold">Soy la dueña</h2>
              <p className="text-sm text-zinc-600">
                Mira la agenda con anticipos pagados y pendientes, los paquetes de cada clienta, a quién reactivar y lo que espera tu aprobación.
              </p>
            </div>
            <OwnerButton />
          </section>
        </div>

        <p className="text-center text-sm text-zinc-500">
          Es un negocio ficticio y los pagos son simulados: no se cobra nada. Los datos se reinician cada noche.
        </p>
      </div>
    </main>
  );
}
