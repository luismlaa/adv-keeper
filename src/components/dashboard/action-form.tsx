"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/dashboard/action-state";
import { cn } from "@/components/lib/utils";

export type DashboardAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

interface Props {
  action: DashboardAction;
  children: React.ReactNode;
  className?: string;
  /** Hide the success message (e.g. when the page re-renders and the row disappears anyway). */
  quietSuccess?: boolean;
}

/** A form bound to a server action through `useActionState`, with inline success/error feedback. */
export function ActionForm({ action, children, className, quietSuccess = false }: Props) {
  const [state, formAction] = useActionState(action, { status: "idle" } satisfies ActionState);
  return (
    <form action={formAction} className={className}>
      {children}
      <ActionFeedback state={state} quietSuccess={quietSuccess} />
    </form>
  );
}

export function ActionFeedback({ state, quietSuccess = false }: { state: ActionState; quietSuccess?: boolean }) {
  if (state.status === "idle" || (state.status === "ok" && quietSuccess && !state.preview)) return null;
  const isError = state.status === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      className={cn(
        "mt-2 w-full rounded-md px-3 py-2 text-sm",
        isError ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-900",
      )}
    >
      {state.message ? <p>{state.message}</p> : null}
      {state.errors && state.errors.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {state.preview ? <p className="mt-2 rounded bg-white/70 p-2 italic text-foreground">“{state.preview}”</p> : null}
    </div>
  );
}
