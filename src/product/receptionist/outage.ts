import type { ReceptionistFailure } from "./engine";

export type OutageDeps = {
  findOrganization(
    clientAccountId: string,
  ): Promise<{ id: string; status: string } | null>;
  record(input: {
    organizationId?: string;
    operation: string;
    errorCode: string;
  }): Promise<void>;
  alertOwners(organizationId: string): Promise<void>;
};

const liveDeps: OutageDeps = {
  async findOrganization(clientAccountId) {
    const { getSaasStore } = await import("@/product/saas/runtime");
    return getSaasStore().findOrganizationByMissedCallClientId(clientAccountId);
  },
  async record(input) {
    const { recordFailure } = await import("@/product/reliability/hooks");
    await recordFailure({
      ...input,
      service: "ai_receptionist",
      severity: "high",
      retryable: true,
    });
  },
  async alertOwners(organizationId) {
    const { emitReceptionistOutage } =
      await import("@/product/notifications/hooks");
    await emitReceptionistOutage(organizationId);
  },
};

function warn(step: string, error: unknown) {
  console.warn(
    `[receptionist] outage ${step} skipped`,
    error instanceof Error ? error.message : "unknown",
  );
}

/**
 * Both halves of a receptionist failure, independently: the platform record
 * that drives incidents and the admin alert, and the critical alert to the
 * business's owners and admins. One failing never prevents the other.
 */
export async function handleReceptionistFailure(
  failure: ReceptionistFailure,
  deps: OutageDeps = liveDeps,
): Promise<void> {
  let organization: { id: string; status: string } | null = null;
  if (failure.clientAccountId) {
    try {
      organization = await deps.findOrganization(failure.clientAccountId);
    } catch (error) {
      warn("organization lookup", error);
    }
  }
  try {
    await deps.record({
      organizationId: organization?.id,
      operation: failure.operation,
      errorCode: failure.errorCode,
    });
  } catch (error) {
    warn("record", error);
  }
  if (organization?.status === "active") {
    try {
      await deps.alertOwners(organization.id);
    } catch (error) {
      warn("owner alert", error);
    }
  }
}
