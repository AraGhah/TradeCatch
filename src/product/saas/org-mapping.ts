import type { BusinessFeatureFlags } from "@/product/demo/types";
import { DEFAULT_DEMO_FEATURES } from "@/product/demo/types";
import type { PlanId } from "./entitlements";
import {
  mergeBusinessFeatures,
  type Organization,
  type OrgStatus,
  type PlatformRole,
  type User,
} from "./types";

export type OrgRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  missed_call_client_id: string | null;
  account_type?: string | null;
  industry?: string | null;
  phone_e164?: string | null;
  city?: string | null;
  service_area?: string | null;
  timezone?: string | null;
  locale_default?: string | null;
  features_json?: BusinessFeatureFlags | Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type UserRow = {
  id: string;
  email: string;
  name: string;
  locale: string;
  platform_role?: string | null;
  notification_phone_e164?: string | null;
  notification_phone_verified_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function parseFeaturesJson(
  raw: BusinessFeatureFlags | Record<string, unknown> | null | undefined,
): BusinessFeatureFlags {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DEMO_FEATURES };
  return mergeBusinessFeatures(raw as Partial<BusinessFeatureFlags>);
}

export function mapOrgRow(row: OrgRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan as PlanId,
    status: row.status as OrgStatus,
    missedCallClientId: row.missed_call_client_id,
    accountType:
      row.account_type === "demo" || row.account_type === "production"
        ? row.account_type
        : "pilot",
    industry: row.industry ?? null,
    phoneE164: row.phone_e164 ?? null,
    city: row.city ?? null,
    serviceArea: row.service_area ?? "",
    timezone: row.timezone?.trim() || "America/Toronto",
    localeDefault: row.locale_default === "fr" ? "fr" : "en",
    features: parseFeaturesJson(row.features_json),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    locale: row.locale === "fr" ? "fr" : "en",
    platformRole:
      row.platform_role === "admin" ? "admin" : ("none" as PlatformRole),
    ...(row.notification_phone_e164 && row.notification_phone_verified_at
      ? {
          notificationPhoneE164: row.notification_phone_e164,
          notificationPhoneVerifiedAt: toIso(
            row.notification_phone_verified_at,
          ),
        }
      : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
