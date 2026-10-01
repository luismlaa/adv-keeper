import { z } from "zod";

/** Shape stored (encrypted) in `integrations` for provider `google_calendar`. */
export const googleCredentialsSchema = z.object({
  refreshToken: z.string().min(1),
  calendarId: z.string().min(1).default("primary"),
});

export type GoogleCredentials = z.infer<typeof googleCredentialsSchema>;

export const GOOGLE_PROVIDER = "google_calendar" as const;
