import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { createMemorySaasStore } from "../../src/product/saas/memory-store";
import { createPostgresSaasStore } from "../../src/product/saas/postgres-store";
import { createMemoryCrmStore } from "../../src/product/crm/memory-store";
import { createPostgresCrmStore } from "../../src/product/crm/postgres-store";
import { createMemorySchedulingStore } from "../../src/product/scheduling/store";
import { createPostgresSchedulingStore } from "../../src/product/scheduling/postgres-store";
import { createMemoryGrowthStore } from "../../src/product/growth/memory-store";
import { createPostgresGrowthStore } from "../../src/product/growth/postgres-store";
import { createMemoryStarterStore } from "../../src/product/starter/memory-store";
import { createPostgresStarterStore } from "../../src/product/starter/postgres-store";
import { createMemorySupportStore } from "../../src/product/support/store";
import { createPostgresSupportStore } from "../../src/product/support/postgres-store";
import { createMemoryReceptionistStore } from "../../src/product/receptionist/store";
import { createPostgresReceptionistStore } from "../../src/product/receptionist/postgres-store";
import { createMemoryStore } from "../../src/product/missed-call/store";
import {
  createPostgresStore,
  closePgPool,
} from "../../src/product/missed-call/postgres-store";
import { demoClientAccount } from "../../src/product/missed-call/fixtures";
import { newId } from "../../src/product/saas/ids";
import { buildAccountExport } from "../../src/product/account-export/archive";
import { accountExportSources } from "../../src/product/account-export/sources";
import type { Organization } from "../../src/product/saas/types";
import {
  installExportStores,
  seedExportRecords,
  type ExportStores,
} from "../support/account-export-fixture";
import { readExportZip } from "../support/read-export-zip";
const db = process.env.ACCOUNT_EXPORT_TEST_DATABASE_URL;
for (const mode of db ? ["memory", "postgres"] : ["memory"])
  describe(`account export sources (${mode})`, () => {
    let stores: ExportStores,
      org: Organization,
      restore: () => void,
      pool: Pool | undefined;
    before(async () => {
      if (mode === "postgres") {
        const url = new URL(db!);
        assert.equal(url.hostname, "127.0.0.1");
        assert.equal(url.pathname, "/account_export_staging");
        pool = new Pool({ connectionString: db });
        stores = {
          crm: createPostgresCrmStore(db!),
          scheduling: createPostgresSchedulingStore(db!),
          growth: createPostgresGrowthStore(db!),
          starter: createPostgresStarterStore(db!),
          support: createPostgresSupportStore(db!),
          receptionist: createPostgresReceptionistStore(db!),
          missed: createPostgresStore(db!),
        };
      } else
        stores = {
          crm: createMemoryCrmStore(),
          scheduling: createMemorySchedulingStore(),
          growth: createMemoryGrowthStore(),
          starter: createMemoryStarterStore(),
          support: createMemorySupportStore(),
          receptionist: createMemoryReceptionistStore(),
          missed: createMemoryStore(),
        };
      restore = installExportStores(stores);
      const client = demoClientAccount();
      client.id = newId("export_client");
      client.smsFromNumber =
        "+1438555" + String(Math.floor(Math.random() * 9000) + 1000);
      await stores.missed.saveClient(client);
      const saas =
        mode === "postgres"
          ? createPostgresSaasStore(db!)
          : createMemorySaasStore();
      org = (
        await saas.createOrganizationWithOwner({
          name: "Account export test",
          ownerEmail: newId("export") + "@example.test",
          ownerName: "Owner",
          accountType: "demo",
          missedCallClientId: client.id,
        })
      ).organization;
      await seedExportRecords(stores, org);
      const other = (
        await saas.createOrganizationWithOwner({
          name: "Other tenant",
          ownerEmail: newId("other") + "@example.test",
          ownerName: "Other",
          accountType: "demo",
        })
      ).organization;
      await stores.crm.upsertCustomer({
        organizationId: other.id,
        phoneE164: "+14385550123",
        displayName: "EXCLUDED_OTHER_TENANT",
        preferredLanguage: "en",
        firstContactAt: new Date().toISOString(),
        lastContactAt: new Date().toISOString(),
      });
    });
    after(async () => {
      restore?.();
      await pool?.end();
      if (mode === "postgres") await closePgPool();
    });
    it("exports all configured sources, orphan customers, legacy records and public support replies without excluded data", async () => {
      const archive = await buildAccountExport(
        org.id,
        accountExportSources(org),
        { limits: { readMs: 15000, totalMs: 120000 } },
      );
      assert.equal(
        archive.manifest.complete,
        true,
        JSON.stringify(
          archive.manifest.sections.filter((s) => s.status !== "complete"),
        ),
      );
      assert.equal(archive.manifest.sections.length, 18);
      const files = readExportZip(archive.bytes);
      assert.equal(Object.keys(files).length, 38);
      assert.equal(JSON.parse(files["customers.json"]).length, 2);
      assert.ok(
        JSON.parse(files["customers.json"]).some(
          (c: { displayName: string }) =>
            c.displayName === "Customer without lead",
        ),
      );
      for (const name of [
        "leads",
        "website_leads",
        "appointments",
        "legacy_appointments",
        "calls",
        "missed_calls",
        "conversations",
        "conversation_messages",
        "quote_threads",
        "quote_messages",
        "support_tickets",
        "support_messages",
        "account_requests",
        "call_transcripts",
      ])
        assert.ok(JSON.parse(files[name + ".json"]).length > 0, name);
      assert.ok(!Object.values(files).join("").includes("EXCLUDED_"));
      assert.match(files["customers.csv"], /"'=1\+2"/);
      assert.match(files["customers.csv"], /"\+14385550123"/);
      assert.ok(
        JSON.parse(files["customers.json"]).some(
          (c: { displayName: string }) => c.displayName === "=1+2",
        ),
      );
      assert.equal((await stores.crm.listCustomers(org.id, 1)).length, 1);
      assert.equal((await stores.crm.listConversations(org.id, 0)).length, 0);
      assert.equal(
        (await stores.scheduling.listAppointments(org.id, 0)).length,
        0,
      );
      assert.equal((await stores.growth.listAppointments(org.id, 0)).length, 0);
      assert.equal(
        (await stores.starter.listWebsiteLeads(org.id, 0)).length,
        0,
      );
      assert.equal(
        (await stores.starter.listQuoteThreads(org.id, 0)).length,
        0,
      );
      assert.equal((await stores.support.listTickets(org.id, 0)).length, 0);
      assert.equal(
        (await stores.support.listAccountRequests(org.id, 0)).length,
        0,
      );
      assert.equal(
        (await stores.missed.listCalls(org.missedCallClientId!, 0)).length,
        0,
      );
    });
    it("marks unavailable and mis-scoped data instead of exporting another tenant or silently returning empty success", async () => {
      const original = stores.crm.listCustomers;
      try {
        stores.crm.listCustomers = async () => {
          throw Error("EXCLUDED_DB_CREDENTIAL");
        };
        const failed = await buildAccountExport(
          org.id,
          accountExportSources(org),
        );
        assert.equal(
          failed.manifest.sections.find((s) => s.name === "customers")?.status,
          "failed",
        );
        assert.ok(
          !new TextDecoder()
            .decode(failed.bytes)
            .includes("EXCLUDED_DB_CREDENTIAL"),
        );
        stores.crm.listCustomers = async () => [
          {
            organizationId: "another",
            displayName: "EXCLUDED_FOREIGN",
          } as never,
        ];
        const scope = await buildAccountExport(
          org.id,
          accountExportSources(org),
        );
        assert.equal(
          scope.manifest.sections.find((s) => s.name === "customers")?.status,
          "failed",
        );
        assert.ok(
          !new TextDecoder().decode(scope.bytes).includes("EXCLUDED_FOREIGN"),
        );
      } finally {
        stores.crm.listCustomers = original;
      }
    });
    it("does not query all phone clients when an organization has no linked client", async () => {
      const archive = await buildAccountExport(
        org.id,
        accountExportSources({ ...org, missedCallClientId: null }),
      );
      for (const name of [
        "calls",
        "missed_calls",
        "missed_call_leads",
        "call_transcripts",
        "missed_call_messages",
      ])
        assert.equal(
          archive.manifest.sections.find((s) => s.name === name)?.status,
          "not_applicable",
        );
    });
    it("reads past the CRM default page and explicitly labels the export cap", async () => {
      const customer = (await stores.crm.listCustomers(org.id, 1))[0];
      const at = new Date().toISOString();
      // Same timestamps exercise deterministic pagination tie-breaking.
      for (let i = 0; i < 201; i++)
        await stores.crm.insertLead({
          id: newId("exp_lead"),
          organizationId: org.id,
          customerId: customer.id,
          source: "manual",
          priority: "low",
          status: "closed",
          createdAt: at,
          updatedAt: at,
        });
      const leads = accountExportSources(org).filter((s) => s.name === "leads");
      const full = await buildAccountExport(org.id, leads);
      assert.equal(full.manifest.sections[0].exportedRows, 202);
      assert.equal(full.manifest.complete, true);
      const capped = await buildAccountExport(org.id, leads, {
        limits: { rows: 200 },
      });
      assert.equal(capped.manifest.sections[0].status, "partial");
      assert.ok(capped.manifest.sections[0].reasons.includes("row_limit"));
    });
  });
