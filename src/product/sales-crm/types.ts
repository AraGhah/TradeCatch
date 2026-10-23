import { z } from "zod";

export const salesLeadSchema = z.object({
  id: z.string(),
  company: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string(),
  city: z.string(),
  trade: z.string(),
  language: z.enum(["en", "fr"]),
  mainProblem: z.string(),
  stage: z.enum(["new", "contacted", "qualified", "won", "lost"]),
  createdAt: z.iso.datetime(),
});
export const salesLeadPageSchema = z.object({
  leads: z.array(salesLeadSchema).max(50),
  hasMore: z.boolean(),
  page: z.number().int().min(1).max(1000),
});
export type SalesLead = z.infer<typeof salesLeadSchema>;
export type SalesLeadPage = z.infer<typeof salesLeadPageSchema>;
