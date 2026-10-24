import { z } from "zod";

export const notificationTimezone = z
  .string()
  .trim()
  .max(100)
  .refine((value) => {
    if (!value) return true;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid timezone.")
  .transform((value) => value || undefined)
  .optional();

export const quietTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const quietHours = z
  .object({
    quietStart: quietTime,
    quietEnd: quietTime,
    quietEnabled: z.boolean(),
  })
  .refine(
    (value) => !value.quietEnabled || value.quietStart !== value.quietEnd,
    {
      message: "Quiet hours must have different start and end times.",
      path: ["quietEnd"],
    },
  );
