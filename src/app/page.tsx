import Link from "next/link";

const BENEFITS = [
  {
    icon: "⚡",
    title: "Responde al instante",
    body: "Precios, duración y horarios exactos desde tu catálogo, a cualquier hora. Sin inventar precios, sin hacer esperar a nadie.",
  },
  {
    icon: "💰",
    title: "Agenda con anticipo",
    body: "Aparta el horario y manda el link de pago de tu Azul o Cardnet. Si no paga a tiempo, el espacio se libera solo.",
  },
  {
    icon: "📦",
    title: "Lleva los paquetes",
    body: "Sabe qué sesión le toca a cada clienta, cuántas le quedan y cuándo debe volver. Le recuerda la cita el día antes.",
  },
  {
    icon: "💌",
    title: "Trae de vuelta a la clienta",
    body: "Te muestra quién lleva más de 6 semanas sin venir y le prepara un mensaje de reenganche listo para enviar.",
  },
] as const;

const STEPS = [
  { n: "1", title: "La clienta escribe", body: "Por WhatsApp o por el chat web: “¿Cuánto cuesta la limpieza facial? ¿Tienes mañana?”" },
  { n: "2", title: "Keeper aparta y cobra", body: "Ofrece horarios reales de tu calendario, aparta la cita y envía el link de anticipo." },
  { n: "3", title: "Tú solo apruebas", body: "La cita pagada aparece confirmada en tu agenda. Descuentos y excepciones te llegan para aprobar." },
] as const;

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-white text-zinc-900">
      <section className="bg-gradient-to-b from-rose-50 to-white px-4 pt-16 pb-20 sm:pt-24">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
          <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold tracking-wide text-rose-700">
            Para spas y salones en República Dominicana
          </span>
          <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Keeper responde, agenda con anticipo, lleva los paquetes y trae de vuelta a la clienta.
          </h1>
          <p className="max-w-xl text-lg text-zinc-600">
            Tu asistente de reservas 24/7 en WhatsApp. Menos mensajes sin contestar, menos clientas que no llegan y más sesiones completadas.
          </p>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/demo"
              className="flex h-12 items-center justify-center rounded-xl bg-rose-600 px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-rose-700"
            >
              Probar la demo
            </Link>
            <a
              href="#como-funciona"
              className="flex h-12 items-center justify-center rounded-xl border border-zinc-300 px-6 text-base font-semibold text-zinc-800 transition-colors hover:bg-zinc-50"
            >
              Cómo funciona
            </a>
          </div>
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b) => (
            <article key={b.title} className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-5">
              <div className="text-2xl" aria-hidden>
                {b.icon}
              </div>
              <h2 className="text-lg font-semibold">{b.title}</h2>
              <p className="text-sm text-zinc-600">{b.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="bg-zinc-50 px-4 py-16">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Cómo funciona</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex flex-col gap-2 rounded-2xl bg-white p-5 shadow-sm">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-600 text-sm font-semibold text-white">
                  {s.n}
                </span>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm text-zinc-600">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="text-center text-sm text-zinc-500">
            El dinero va directo a tu cuenta: Keeper solo manda el link de pago y nunca toca datos de tarjetas.
          </p>
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Pruébalo en 2 minutos</h2>
          <p className="text-zinc-600">Escríbele al spa de demostración como clienta, o entra al panel como la dueña. Sin registro.</p>
          <Link
            href="/demo"
            className="flex h-12 items-center justify-center rounded-xl bg-zinc-900 px-6 text-base font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            Ir a la demo
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-200 px-4 py-6 text-center text-xs text-zinc-500">Keeper · Hecho en RD</footer>
    </main>
  );
}
