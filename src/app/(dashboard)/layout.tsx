import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/dashboard/nav";
import { Button } from "@/components/ui/button";
import { getOwnerContext, NoBusinessError, type OwnerContext } from "@/lib/dashboard/context";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Panel · Keeper" };

async function countPendingApprovals(ctx: OwnerContext): Promise<number> {
  const { count } = await ctx.db
    .from("approval_requests")
    .select("id", { count: "exact", head: true })
    .eq("business_id", ctx.business.id)
    .eq("status", "pending");
  return count ?? 0;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let ctx: OwnerContext | null;
  try {
    ctx = await getOwnerContext();
  } catch (error) {
    if (error instanceof NoBusinessError) return <NoBusiness />;
    throw error;
  }
  if (ctx === null) redirect("/login");
  const pending = await countPendingApprovals(ctx);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Keeper</p>
              <p className="truncate font-semibold" data-testid="business-name">
                {ctx.business.name}
              </p>
            </div>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Salir
              </Button>
            </form>
          </div>
          <DashboardNav pendingApprovals={pending} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}

function NoBusiness() {
  return (
    <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Tu usuario no tiene un negocio asignado</h1>
      <p className="mt-2 text-sm text-muted-foreground">Pide a Keeper que te agregue como dueña de tu spa o salón.</p>
      <form action={signOut} className="mt-6">
        <Button type="submit" variant="outline">
          Salir
        </Button>
      </form>
    </main>
  );
}
