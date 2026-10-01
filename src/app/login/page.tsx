import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/dashboard/action-state";
import type { SearchPageProps } from "@/lib/dashboard/route-props";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar · Keeper" };

export default async function LoginPage({ searchParams }: SearchPageProps) {
  const { next } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Entrar a Keeper</CardTitle>
          <CardDescription>Panel de la dueña: agenda, clientas, paquetes y aprobaciones.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={safeNextPath(next)} />
        </CardContent>
      </Card>
    </main>
  );
}
