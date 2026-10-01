"use client";

import { useActionState } from "react";
import { enterAsDemoOwner, type OwnerLoginState } from "./actions";

const initialState: OwnerLoginState = { error: null };

export function OwnerButton() {
  const [state, formAction, pending] = useActionState(enterAsDemoOwner, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Entrando…" : "Entrar al panel"}
      </button>
      {state.error !== null && (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
