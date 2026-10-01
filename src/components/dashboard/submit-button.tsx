"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

type Props = React.ComponentProps<typeof Button> & { pendingLabel?: string };

/** Submit button that disables itself and shows a pending label while its form's action runs. */
export function SubmitButton({ children, pendingLabel = "Guardando…", disabled, ...props }: Props) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
