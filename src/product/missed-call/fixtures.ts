import { defaultApprovedQuestions } from "./messaging";
import { defaultUrgencyRubric } from "./urgency";
import type { ClientAccount } from "./types";

export function defaultServiceAreas() {
  return [
    {
      id: "area_laval",
      label: "Laval",
      matchTokens: ["laval", "h7", "h7a", "h7b", "h7g"],
    },
    {
      id: "area_montreal_nord",
      label: "Montréal-Nord",
      matchTokens: ["montreal nord", "montréal nord", "h1g", "h1h"],
    },
  ];
}

export function demoClientAccount(
  overrides: Partial<ClientAccount> = {},
): ClientAccount {
  const mainId = "tech_marc";
  const backupId = "tech_sophie";
  const ownerId = "tech_owner";

  return {
    id: "client_demo",
    name: "Nord Plumbing Inc.",
    contractorDisplayName: "Nord Plomberie",
    timezone: "America/Toronto",
    businessHours: {
      start: "08:00",
      end: "17:00",
      days: [1, 2, 3, 4, 5],
    },
    approvedServiceAreas: defaultServiceAreas(),
    urgencyRubric: defaultUrgencyRubric(),
    technicianRoster: [
      {
        id: mainId,
        name: "Marc D.",
        phone: "+15145550199",
        role: "primary",
        active: true,
      },
      {
        id: backupId,
        name: "Sophie L.",
        phone: "+15145550288",
        role: "backup",
        active: true,
      },
      {
        id: ownerId,
        name: "Alex Propriétaire",
        phone: "+15145550377",
        role: "owner",
        active: true,
      },
    ],
    mainTechnicianId: mainId,
    backupTechnicianIds: [backupId],
    ownerTechnicianId: ownerId,
    onCallSchedule: [
      { day: 1, start: "08:00", end: "17:00", technicianId: mainId },
      { day: 2, start: "08:00", end: "17:00", technicianId: mainId },
      { day: 3, start: "08:00", end: "17:00", technicianId: mainId },
      { day: 4, start: "08:00", end: "17:00", technicianId: mainId },
      { day: 5, start: "08:00", end: "17:00", technicianId: mainId },
      { day: 0, start: "00:00", end: "23:59", technicianId: backupId },
      { day: 6, start: "00:00", end: "23:59", technicianId: backupId },
    ],
    escalationPolicy: {
      primaryResponseMs: 5 * 60 * 1000,
      backupResponseMs: 5 * 60 * 1000,
      ownerResponseMs: 10 * 60 * 1000,
    },
    humanReviewPhone: "+15145550377",
    onCallTechnicians: [
      {
        id: mainId,
        name: "Marc D.",
        phone: "+15145550199",
        active: true,
      },
    ],
    approvedQuestions: defaultApprovedQuestions(),
    smsFromNumber: "+15145550100",
    optOutKeywords: ["stop", "arret", "arrêt"],
    duplicateWindowMs: 30 * 60 * 1000,
    ...overrides,
  };
}
