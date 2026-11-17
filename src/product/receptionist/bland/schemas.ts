/**
 * Request shapes for the Bland tools.
 *
 * A Bland tool body is a template: every `{{input.x}}` is replaced by text, so
 * nothing in it can be a nested object, a number or a real boolean. These
 * schemas are therefore flat and tolerant of "true"/"false" strings; each one
 * is turned into the same shape the other voice agents send, so the shared
 * services see one contract.
 */

import { z } from "zod";
import {
  agentBaseSchema,
  detailsSchema,
  reportSchema,
  slotsSchema,
} from "../agent-api";

/** "true" / "false" as text (a template cannot send a JSON boolean). */
const flag = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

const SLOT_KEYS = Object.keys(slotsSchema.shape) as (keyof typeof slotsSchema.shape)[];

function pickSlots(source: Record<string, unknown>) {
  const slots: Record<string, string> = {};
  for (const key of SLOT_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) slots[key] = value;
  }
  return slots as z.infer<typeof slotsSchema>;
}

export const blandDetailsSchema = agentBaseSchema
  .extend(slotsSchema.shape)
  .transform(
    (flat): z.infer<typeof detailsSchema> => ({
      number: flat.number,
      callId: flat.callId,
      from: flat.from,
      language: flat.language,
      slots: pickSlots(flat),
    }),
  );

export const blandReportSchema = agentBaseSchema
  .extend(slotsSchema.shape)
  .extend({
    intent: reportSchema.shape.intent,
    emergency: flag.optional(),
    endReason: reportSchema.shape.endReason,
    /** The model's own account of a transfer. Never trusted as proof a person answered. */
    transferCompleted: flag.optional(),
    transferTarget: z.string().max(80).optional(),
  })
  .transform(
    (flat): z.infer<typeof reportSchema> => ({
      number: flat.number,
      callId: flat.callId,
      from: flat.from,
      language: flat.language,
      intent: flat.intent,
      slots: pickSlots(flat),
      emergency: flat.emergency,
      endReason: flat.endReason,
      transfer:
        flat.transferCompleted === undefined && !flat.transferTarget
          ? undefined
          : {
              targetName: flat.transferTarget,
              completed: flat.transferCompleted ?? false,
              // Bland does not tell us who answered: never claim a person did.
              answerConfirmed: false,
            },
    }),
  );

/**
 * Drops what a template left unfilled. When the model gives no value for an
 * input, Bland may send the literal `{{input.x}}` or an empty string; neither
 * is something the caller said.
 */
export function dropUnresolved(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text || /^\{\{[^{}]*\}\}$/.test(text)) continue;
      clean[key] = value;
    } else {
      clean[key] = value;
    }
  }
  return clean;
}
