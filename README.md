# 💆 Keeper

**Keeper responde, agenda con anticipo, lleva los paquetes y trae de vuelta a la clienta.**
Es un asistente para spas y salones en República Dominicana. Contesta precios y servicios al instante, agenda 24/7 y pide un anticipo por link de pago (Azul/Cardnet) para asegurar cada cita. También envía recordatorios para reducir el no-show, lleva la cuenta de los paquetes multi-sesión ("te toca la sesión 4 de 10, ¿agendamos?") y señala a las clientas que llevan más de 6 semanas sin volver. La dueña trabaja desde un dashboard que muestra la agenda con el estado de cada anticipo (💰 pagado o pendiente), la ficha de cada clienta con sus paquetes y la lista de reactivación.

## Stack
Next.js 16 (App Router) · TypeScript strict · Supabase (Postgres + Auth + RLS, multi-tenant) · Claude vía Anthropic SDK (tool use) · zod · vitest · Vercel (app + crons). Los canales de producción son WhatsApp Cloud API, Google Calendar y Azul/Cardnet con página de pago hospedada; Keeper nunca maneja datos de tarjeta.

## Correrlo en local
```bash
npm install
cp .env.example .env.local          # llenar Supabase, Anthropic, ENCRYPTION_KEY, CRON_SECRET, DEMO_*
# aplicar supabase/migrations/*.sql en tu proyecto Supabase (SQL editor o `npx supabase db push`)
npm run seed:demo                   # crea el tenant "Spa Demo" + usuaria demo
npm run dev                         # http://localhost:3000
```

## Tests
```bash
npm run check    # typecheck + lint + vitest (unit + smoke)
```

## Documentos
- `docs/deploy.md`: desplegar en Vercel + Supabase.
- `docs/onboarding-negocio.md`: pasos para poner en vivo a un negocio que contrata.
- `docs/demo-pitch.md`: guion de la demo para reuniones.
- `tasks/todo.md`: roadmap y estado.
- `tasks/parallel-prompts.md`: prompts para construir en paralelo con worktrees.
