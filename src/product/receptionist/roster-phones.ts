import type { ClientAccount } from "@/product/missed-call/types";

/** The owner technician's phone, only while that roster entry is active. */
export function ownerPhone(client: ClientAccount): string | undefined {
  const id = client.ownerTechnicianId;
  return id
    ? client.technicianRoster.find((t) => t.id === id && t.active)?.phone
    : undefined;
}

/** The main technician's phone, only while that roster entry is active. */
export function primaryPhone(client: ClientAccount): string | undefined {
  return client.technicianRoster.find(
    (t) => t.id === client.mainTechnicianId && t.active,
  )?.phone;
}
