/**
 * Phone formats: Keeper stores E.164 with a plus (`+18095550001`, same as the web chat); the Cloud
 * API sends and expects bare digits (`18095550001`).
 */

export function toWhatsAppRecipient(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("Invalid WhatsApp recipient phone number");
  return digits;
}

/** `wa_id` / `from` of an inbound message → Keeper's stored client phone. */
export function fromWhatsAppId(waId: string): string {
  return `+${waId.replace(/\D/g, "")}`;
}
