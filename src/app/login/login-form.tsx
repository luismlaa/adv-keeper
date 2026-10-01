"use client";

import { useActionState } from "react";
import { ActionFeedback } from "@/components/dashboard/action-form";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/dashboard/action-state";
import { signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, { status: "idle" } satisfies ActionState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Correo</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="tu@spa.com" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <SubmitButton className="h-10 w-full" pendingLabel="Entrando…">
        Entrar
      </SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}
