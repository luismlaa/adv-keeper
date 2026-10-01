"use client";

import { useActionState } from "react";
import { payDemoDeposit, type PayState } from "./actions";

const initialState: PayState = { error: null };

export function PayButton({ linkId, amountLabel }: { linkId: string; amountLabel: string }) {
  const [state, formAction, pending] = useActionState(payDemoDeposit, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="linkId" value={linkId} />
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-xl bg-emerald-600 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Procesando pago…" : `Pagar anticipo · ${amountLabel}`}
      </button>
      {state.error !== null && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
    </form>
  );
}
