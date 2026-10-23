import { z } from "zod";

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
