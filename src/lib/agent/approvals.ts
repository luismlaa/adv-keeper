import type { ApprovalKind } from "@/lib/schemas/entities";
import type { ToolName } from "./tools";

/**
 * Action tiers — enforced in code, not just in the prompt.
 * - auto: the concierge may run it on its own (read-only, or bookings at catalog price).
 * - queue_for_owner: only records a request; the owner resolves it in the dashboard.
 * Money-moving or price-changing actions (discounts, off-menu prices, cancellations, refunds) have
 * NO tool at all — the only path is `request_owner_approval`.
 */
export const TOOL_TIERS: Readonly<Record<ToolName, "auto" | "queue_for_owner">> = {
  list_services: "auto",
  check_availability: "auto",
  get_client_packages: "auto",
  create_booking_hold: "auto",
  create_deposit_link: "auto",
  request_owner_approval: "queue_for_owner",
};

export const OWNER_ONLY_ACTIONS: readonly ApprovalKind[] = ["discount", "off_menu_price", "cancellation", "refund"];

/** Hard caps per client turn (layer-3 guardrails). */
export const TURN_LIMITS = {
  maxToolCalls: 8,
  maxHoldsPerTurn: 1,
  maxApprovalRequestsPerTurn: 2,
} as const;
