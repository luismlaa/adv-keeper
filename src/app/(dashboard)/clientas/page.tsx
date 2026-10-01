import Link from "next/link";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listClients } from "@/lib/dashboard/clients-queries";
import { requireOwnerContext } from "@/lib/dashboard/context";
import { formatDate } from "@/lib/dashboard/format";
import type { SearchPageProps } from "@/lib/dashboard/route-props";

export default async function ClientsPage({ searchParams }: SearchPageProps) {
  const ctx = await requireOwnerContext();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const clients = await listClients(ctx, query);

  return (
    <div>
      <PageHeader title="Clientas" description={`${clients.length} ${clients.length === 1 ? "clienta" : "clientas"}${query ? " encontradas" : ""}`} />
      <form className="mb-4 flex gap-2" role="search">
        <Input name="q" defaultValue={query} placeholder="Buscar por nombre o teléfono" aria-label="Buscar clienta" className="h-9" />
        <Button type="submit" variant="outline" className="h-9">
          Buscar
        </Button>
      </form>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {query ? "Ninguna clienta coincide con tu búsqueda." : "Todavía no hay clientas."}
        </p>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <ul className="divide-y">
              {clients.map((c) => (
                <li key={c.id}>
                  <Link href={`/clientas/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name ?? "Sin nombre"}</p>
                      <p className="text-sm text-muted-foreground">{c.phone}</p>
                    </div>
                    <p className="shrink-0 text-right text-xs text-muted-foreground">
                      {c.lastVisitAt ? (
                        <>
                          Última visita
                          <br />
                          {formatDate(c.lastVisitAt, ctx.settings.timezone)}
                        </>
                      ) : (
                        "Sin visitas"
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
