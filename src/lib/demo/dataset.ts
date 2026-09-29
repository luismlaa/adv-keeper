import { DEFAULT_BUSINESS_SETTINGS } from "@/lib/config/business-settings";
import { computeDeposit } from "@/lib/domain/money";
import { addMinutes, DAY_MS, localDayOf, shiftLocalDay, zonedWallTime } from "@/lib/domain/time";
import type { Appointment, Business, Client, ClientPackage, Deposit, PackageTemplate, Service } from "@/lib/schemas/entities";

/** Fixed id so the demo tenant keeps the same identity across nightly resets. */
export const DEMO_BUSINESS_ID = "00000000-0000-4000-8000-00000000d3e0";

export interface DemoDataset {
  business: Business;
  services: Service[];
  packageTemplates: PackageTemplate[];
  clients: Client[];
  clientPackages: ClientPackage[];
  appointments: Appointment[];
  deposits: Deposit[];
}

const SERVICES = [
  { key: "facial", name: "Limpieza facial profunda", category: "Facial", durationMin: 60, price: 3500, description: "Extracción, exfoliación y mascarilla hidratante." },
  { key: "relax", name: "Masaje relajante", category: "Masajes", durationMin: 60, price: 3000, description: "Aceites esenciales, presión suave." },
  { key: "deep", name: "Masaje descontracturante", category: "Masajes", durationMin: 75, price: 3800, description: "Presión media-fuerte en espalda y cuello." },
  { key: "laser-axila", name: "Depilación láser axilas", category: "Láser", durationMin: 20, price: 1500, description: "Diodo, todo tipo de piel." },
  { key: "laser-piernas", name: "Depilación láser piernas completas", category: "Láser", durationMin: 60, price: 4500, description: "Diodo, todo tipo de piel." },
  { key: "manipedi", name: "Manicure + pedicure spa", category: "Uñas", durationMin: 90, price: 2200, description: "Con exfoliación y parafina." },
  { key: "drenaje", name: "Drenaje linfático", category: "Corporal", durationMin: 60, price: 3200, description: "Técnica manual Vodder." },
  { key: "rf", name: "Radiofrecuencia facial", category: "Facial", durationMin: 45, price: 2800, description: "Reafirmante, sin tiempo de recuperación." },
] as const;

type ServiceKey = (typeof SERVICES)[number]["key"];

const PACKAGES = [
  { key: "laser10", service: "laser-piernas", name: "Láser piernas · 10 sesiones", sessions: 10, price: 36000, intervalDays: 30 },
  { key: "drenaje8", service: "drenaje", name: "Drenaje linfático · 8 sesiones", sessions: 8, price: 22000, intervalDays: 7 },
  { key: "rf6", service: "rf", name: "Radiofrecuencia · 6 sesiones", sessions: 6, price: 14000, intervalDays: 14 },
] as const;

const CLIENT_NAMES = [
  "Mariela Peña", "Yokasta Rodríguez", "Laura Batista", "Carolina Almonte", "Paola Jiménez",
  "Rosanna Castillo", "Wendy Guzmán", "Ana Lucía Féliz", "Katherine Núñez", "Melissa Tavárez",
  "Scarlet Reyes", "Nicole Espaillat", "Daniela Mejía", "Gabriela Santana", "Leidy Ureña",
  "Patricia Cabrera", "Isabel Vargas", "Johanna Polanco", "Estefany Rosario", "Francis De León",
];

/** Clients 12–19 are the "para reactivar" list: last visit 45–130 days ago, nothing booked. */
const REACTIVATION_DAYS_AGO = [45, 52, 60, 68, 77, 90, 104, 130];

/** (local day offset, "HH:MM", service, client index, package key?) — no overlaps, inside opening hours. */
const SCHEDULE: ReadonlyArray<readonly [number, string, ServiceKey, number, string?]> = [
  [-3, "09:00", "facial", 0],
  [-3, "11:00", "laser-piernas", 1, "laser10"],
  [-3, "15:00", "manipedi", 2],
  [-2, "10:00", "drenaje", 3, "drenaje8"],
  [-2, "14:00", "relax", 4],
  [-1, "09:30", "rf", 5, "rf6"],
  [-1, "12:00", "deep", 6],
  [-1, "16:00", "laser-axila", 7],
  [0, "09:00", "facial", 8],
  [0, "11:00", "drenaje", 3, "drenaje8"],
  [0, "15:30", "manipedi", 9],
  [1, "10:00", "relax", 10],
  [1, "13:00", "laser-piernas", 1, "laser10"],
  [1, "16:00", "deep", 11],
  [2, "09:00", "rf", 5, "rf6"],
  [2, "11:30", "facial", 0],
  [3, "10:00", "manipedi", 2],
  [3, "14:00", "laser-axila", 4],
  [4, "09:00", "relax", 6],
  [5, "11:00", "deep", 7],
  [6, "10:00", "drenaje", 3, "drenaje8"],
];

const uuidFrom = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** Deterministic demo tenant relative to `now` (so "hoy" and "esta semana" always look alive). */
export function buildDemoDataset(now: Date, opts: { slug: string; appUrl: string }): DemoDataset {
  const settings = DEFAULT_BUSINESS_SETTINGS;
  const tz = settings.timezone;
  let seq = 0x1000;
  const nextId = () => uuidFrom(seq++);

  const business: Business = {
    id: DEMO_BUSINESS_ID,
    slug: opts.slug,
    name: "Spa Demo · Keeper",
    integrationMode: "demo",
    paymentProvider: "fake",
    googleCalendarId: "demo",
    whatsappPhoneNumberId: null,
    settings: { ownerDisplayName: "Ana, la dueña" },
  };

  const services: Service[] = SERVICES.map((s) => ({
    id: nextId(),
    businessId: business.id,
    name: s.name,
    description: s.description,
    category: s.category,
    durationMin: s.durationMin,
    priceMinor: s.price * 100,
    depositOverrideMinor: null,
    active: true,
  }));
  const serviceByKey = new Map(SERVICES.map((s, i) => [s.key, services[i]!]));

  const packageTemplates: PackageTemplate[] = PACKAGES.map((p) => ({
    id: nextId(),
    businessId: business.id,
    serviceId: serviceByKey.get(p.service)!.id,
    name: p.name,
    sessionsTotal: p.sessions,
    priceMinor: p.price * 100,
    intervalDays: p.intervalDays,
    active: true,
  }));
  const templateByKey = new Map(PACKAGES.map((p, i) => [p.key as string, packageTemplates[i]!]));

  const clients: Client[] = CLIENT_NAMES.map((name, i) => {
    const reactivationIndex = i - 12;
    const daysAgo = REACTIVATION_DAYS_AGO[reactivationIndex];
    return {
      id: nextId(),
      businessId: business.id,
      name,
      phone: `+1809555${(1000 + i).toString()}`,
      email: null,
      notes: i === 2 ? "Prefiere tardes. Alergia a la lavanda." : null,
      lastVisitAt: daysAgo === undefined ? new Date(now.getTime() - (20 + i) * DAY_MS).toISOString() : new Date(now.getTime() - daysAgo * DAY_MS).toISOString(),
      lastReengagedAt: null,
    };
  });

  // Package owners: (client index, package key, sessions already used before this week)
  const packageOwners: ReadonlyArray<readonly [number, string, number]> = [
    [1, "laser10", 3],
    [3, "drenaje8", 2],
    [5, "rf6", 1],
    [13, "rf6", 4],
  ];
  const today = localDayOf(now, tz);
  const appointments: Appointment[] = [];
  const deposits: Deposit[] = [];
  const completedPerPackage = new Map<string, number>();

  const clientPackages: ClientPackage[] = packageOwners.map(([clientIndex, key]) => ({
    id: nextId(),
    businessId: business.id,
    clientId: clients[clientIndex]!.id,
    packageTemplateId: templateByKey.get(key)!.id,
    sessionsTotal: templateByKey.get(key)!.sessionsTotal,
    sessionsUsed: 0,
    status: "active",
    purchasedAt: new Date(now.getTime() - 90 * DAY_MS).toISOString(),
    expiresAt: null,
  }));
  const packageFor = (clientIndex: number, key: string) =>
    clientPackages.find((p) => p.clientId === clients[clientIndex]!.id && p.packageTemplateId === templateByKey.get(key)!.id)!;

  SCHEDULE.forEach(([offset, hhmm, serviceKey, clientIndex, packageKey], i) => {
    const service = serviceByKey.get(serviceKey)!;
    const day = shiftLocalDay(today, offset, tz);
    const start = zonedWallTime(day.year, day.monthIndex, day.day, hhmm, tz);
    const end = addMinutes(start, service.durationMin);
    const windows = settings.weeklyHours[String(day.weekday) as keyof typeof settings.weeklyHours];
    const fitsOpeningHours = windows.some(
      (w) => start >= zonedWallTime(day.year, day.monthIndex, day.day, w.open, tz) && end <= zonedWallTime(day.year, day.monthIndex, day.day, w.close, tz),
    );
    if (!fitsOpeningHours) return; // e.g. Sundays or a Saturday afternoon: the business is closed.
    const pkg = packageKey === undefined ? null : packageFor(clientIndex, packageKey);
    const isPast = end <= now;
    const pendingDeposit = !isPast && pkg === null && i % 3 === 0;
    const status: Appointment["status"] = isPast ? (i === 7 ? "no_show" : "completed") : pendingDeposit ? "hold_pending_deposit" : "confirmed";
    const depositMinor = pkg === null ? computeDeposit(service.priceMinor, settings.deposit, service.depositOverrideMinor) : 0;

    const appointment: Appointment = {
      id: nextId(),
      businessId: business.id,
      clientId: clients[clientIndex]!.id,
      serviceId: service.id,
      clientPackageId: pkg?.id ?? null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      status,
      priceMinor: pkg === null ? service.priceMinor : 0,
      depositMinor,
      // Demo holds stay pending all day so pitches always show "pendiente"; the nightly reset refreshes them.
      holdExpiresAt: status === "hold_pending_deposit" ? addMinutes(now, 20 * 60).toISOString() : null,
      calendarEventId: null,
      source: i % 4 === 0 ? "owner" : "chat",
      notes: null,
    };
    appointments.push(appointment);

    if (pkg !== null && status === "completed") completedPerPackage.set(pkg.id, (completedPerPackage.get(pkg.id) ?? 0) + 1);
    if (depositMinor > 0) {
      const linkId = `demo_seed_${i}`;
      const paid = status !== "hold_pending_deposit";
      deposits.push({
        id: nextId(),
        businessId: business.id,
        appointmentId: appointment.id,
        provider: "fake",
        linkId,
        url: `${opts.appUrl.replace(/\/$/, "")}/pay/demo/${linkId}`,
        amountMinor: depositMinor,
        currency: settings.currency,
        status: paid ? "paid" : "pending",
        providerTxnId: paid ? `demo_txn_${i}` : null,
        expiresAt: paid ? start.toISOString() : appointment.holdExpiresAt!,
        paidAt: paid ? new Date(start.getTime() - 3 * DAY_MS).toISOString() : null,
      });
    }
  });

  const finalPackages = clientPackages.map((p) => {
    const baseline = packageOwners.find(([ci, key]) => clients[ci]!.id === p.clientId && templateByKey.get(key)!.id === p.packageTemplateId)![2];
    return { ...p, sessionsUsed: Math.min(baseline + (completedPerPackage.get(p.id) ?? 0), p.sessionsTotal) };
  });

  // Last visit reflects the most recent completed appointment when there is one this week.
  const finalClients = clients.map((c) => {
    const lastCompleted = appointments
      .filter((a) => a.clientId === c.id && a.status === "completed")
      .map((a) => a.startsAt)
      .sort()
      .at(-1);
    return lastCompleted === undefined ? c : { ...c, lastVisitAt: lastCompleted };
  });

  return { business, services, packageTemplates, clients: finalClients, clientPackages: finalPackages, appointments, deposits };
}
