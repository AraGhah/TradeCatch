import { createId } from "@/lib/id";
import type { Pool } from "pg";
import { getPgPool } from "@/product/missed-call/postgres-store";
import type { SchedulingStore, StoredConnection } from "./store";
import type {
  AvailabilityRules,
  BusyBlock,
  ScheduleAppointment,
  ServiceType,
  Technician,
} from "./types";

function rulesFrom(row: Record<string, unknown>): AvailabilityRules {
  return {
    organizationId: String(row.organization_id),
    timezone: String(row.timezone),
    days: (row.days_json ?? {}) as AvailabilityRules["days"],
    defaultDurationMinutes: Number(row.default_duration_minutes),
    bufferMinutes: Number(row.buffer_minutes),
    travelBufferMinutes: Number(row.travel_buffer_minutes),
    minimumNoticeMinutes: Number(row.minimum_notice_minutes),
    maxAdvanceDays: Number(row.max_advance_days),
    maxDailyBookings: row.max_daily_bookings == null ? undefined : Number(row.max_daily_bookings),
    holidays: (row.holidays_json ?? []) as string[],
    calendarMode: row.calendar_mode as AvailabilityRules["calendarMode"],
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function serviceFrom(row: Record<string, unknown>): ServiceType {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    durationMinutes: Number(row.duration_minutes),
    bufferMinutes: row.buffer_minutes == null ? undefined : Number(row.buffer_minutes),
    bookingMode: row.booking_mode as ServiceType["bookingMode"],
    eligibleTechnicianIds: (row.eligible_technician_ids ?? []) as string[],
    serviceArea: row.service_area ? String(row.service_area) : undefined,
    active: Boolean(row.active),
  };
}

function appointmentFrom(row: Record<string, unknown>): ScheduleAppointment {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    customerName: row.customer_name ? String(row.customer_name) : undefined,
    customerPhoneE164: row.customer_phone_e164 ? String(row.customer_phone_e164) : undefined,
    customerEmail: row.customer_email ? String(row.customer_email) : undefined,
    serviceAddress: row.service_address ? String(row.service_address) : undefined,
    serviceId: row.service_id ? String(row.service_id) : undefined,
    serviceName: String(row.service_name),
    technicianId: row.technician_id ? String(row.technician_id) : undefined,
    technicianName: row.technician_name ? String(row.technician_name) : undefined,
    leadId: row.lead_id ? String(row.lead_id) : undefined,
    startAt: new Date(String(row.start_at)).toISOString(),
    endAt: new Date(String(row.end_at)).toISOString(),
    timezone: String(row.timezone),
    status: row.status as ScheduleAppointment["status"],
    bookingSource: row.booking_source as ScheduleAppointment["bookingSource"],
    appointmentKind: row.appointment_kind as ScheduleAppointment["appointmentKind"],
    calendarEventId: row.calendar_event_id ? String(row.calendar_event_id) : undefined,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : undefined,
    simulated: Boolean(row.simulated),
    holdExpiresAt: row.hold_expires_at ? new Date(String(row.hold_expires_at)).toISOString() : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function createPostgresSchedulingStore(connectionString: string): SchedulingStore {
  const pool = getPgPool(connectionString);

  async function writeAppointment(
    row: ScheduleAppointment,
    client: { query: Pool["query"] } = pool,
  ) {
    await client.query(
      `INSERT INTO tc_schedule_appointments (
        id, organization_id, customer_name, customer_phone_e164, customer_email,
        service_address, service_id, service_name, technician_id, technician_name,
        lead_id, start_at, end_at, timezone, status, booking_source, appointment_kind,
        calendar_event_id, idempotency_key, cancel_reason, simulated, hold_expires_at,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24
      )
      ON CONFLICT (id) DO UPDATE SET
        customer_name = EXCLUDED.customer_name,
        customer_phone_e164 = EXCLUDED.customer_phone_e164,
        customer_email = EXCLUDED.customer_email,
        service_address = EXCLUDED.service_address,
        service_id = EXCLUDED.service_id,
        service_name = EXCLUDED.service_name,
        technician_id = EXCLUDED.technician_id,
        technician_name = EXCLUDED.technician_name,
        lead_id = EXCLUDED.lead_id,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        timezone = EXCLUDED.timezone,
        status = EXCLUDED.status,
        booking_source = EXCLUDED.booking_source,
        appointment_kind = EXCLUDED.appointment_kind,
        calendar_event_id = EXCLUDED.calendar_event_id,
        idempotency_key = EXCLUDED.idempotency_key,
        cancel_reason = EXCLUDED.cancel_reason,
        simulated = EXCLUDED.simulated,
        hold_expires_at = EXCLUDED.hold_expires_at,
        updated_at = EXCLUDED.updated_at`,
      [
        row.id, row.organizationId, row.customerName ?? null, row.customerPhoneE164 ?? null,
        row.customerEmail ?? null, row.serviceAddress ?? null, row.serviceId ?? null,
        row.serviceName, row.technicianId ?? null, row.technicianName ?? null, row.leadId ?? null,
        row.startAt, row.endAt, row.timezone, row.status, row.bookingSource, row.appointmentKind,
        row.calendarEventId ?? null, row.idempotencyKey ?? null, row.cancelReason ?? null,
        row.simulated, row.holdExpiresAt ?? null, row.createdAt, row.updatedAt,
      ],
    );
  }

  return {
    async getRules(organizationId) {
      const res = await pool.query(`SELECT * FROM tc_availability_rules WHERE organization_id = $1`, [organizationId]);
      return res.rows[0] ? rulesFrom(res.rows[0]) : null;
    },
    async saveRules(rules) {
      await pool.query(
        `INSERT INTO tc_availability_rules (
          organization_id, timezone, days_json, default_duration_minutes, buffer_minutes,
          travel_buffer_minutes, minimum_notice_minutes, max_advance_days, max_daily_bookings,
          holidays_json, calendar_mode, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (organization_id) DO UPDATE SET
          timezone = EXCLUDED.timezone,
          days_json = EXCLUDED.days_json,
          default_duration_minutes = EXCLUDED.default_duration_minutes,
          buffer_minutes = EXCLUDED.buffer_minutes,
          travel_buffer_minutes = EXCLUDED.travel_buffer_minutes,
          minimum_notice_minutes = EXCLUDED.minimum_notice_minutes,
          max_advance_days = EXCLUDED.max_advance_days,
          max_daily_bookings = EXCLUDED.max_daily_bookings,
          holidays_json = EXCLUDED.holidays_json,
          calendar_mode = EXCLUDED.calendar_mode,
          updated_at = EXCLUDED.updated_at`,
        [
          rules.organizationId, rules.timezone, JSON.stringify(rules.days),
          rules.defaultDurationMinutes, rules.bufferMinutes, rules.travelBufferMinutes,
          rules.minimumNoticeMinutes, rules.maxAdvanceDays, rules.maxDailyBookings ?? null,
          JSON.stringify(rules.holidays), rules.calendarMode, rules.updatedAt,
        ],
      );
      return rules;
    },
    async listServices(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_service_types WHERE organization_id = $1 ORDER BY name`,
        [organizationId],
      );
      return res.rows.map(serviceFrom);
    },
    async saveService(service) {
      await pool.query(
        `INSERT INTO tc_service_types (
          id, organization_id, name, description, duration_minutes, buffer_minutes,
          booking_mode, eligible_technician_ids, service_area, active, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, description = EXCLUDED.description,
          duration_minutes = EXCLUDED.duration_minutes, buffer_minutes = EXCLUDED.buffer_minutes,
          booking_mode = EXCLUDED.booking_mode, eligible_technician_ids = EXCLUDED.eligible_technician_ids,
          service_area = EXCLUDED.service_area, active = EXCLUDED.active, updated_at = now()`,
        [
          service.id, service.organizationId, service.name, service.description ?? null,
          service.durationMinutes, service.bufferMinutes ?? null, service.bookingMode,
          JSON.stringify(service.eligibleTechnicianIds), service.serviceArea ?? null, service.active,
        ],
      );
      return service;
    },
    async listTechnicians(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_technicians WHERE organization_id = $1 ORDER BY name`,
        [organizationId],
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        name: String(row.name),
        serviceArea: row.service_area ? String(row.service_area) : undefined,
        active: Boolean(row.active),
      })) satisfies Technician[];
    },
    async saveTechnician(technician) {
      await pool.query(
        `INSERT INTO tc_technicians (id, organization_id, name, service_area, active)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, service_area = EXCLUDED.service_area, active = EXCLUDED.active`,
        [technician.id, technician.organizationId, technician.name, technician.serviceArea ?? null, technician.active],
      );
      return technician;
    },
    async listAppointments(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_schedule_appointments WHERE organization_id = $1 ORDER BY start_at`,
        [organizationId],
      );
      return res.rows.map(appointmentFrom);
    },
    async getAppointment(organizationId, id) {
      const res = await pool.query(
        `SELECT * FROM tc_schedule_appointments WHERE organization_id = $1 AND id = $2`,
        [organizationId, id],
      );
      return res.rows[0] ? appointmentFrom(res.rows[0]) : null;
    },
    async findByIdempotency(organizationId, key) {
      const res = await pool.query(
        `SELECT * FROM tc_schedule_appointments WHERE organization_id = $1 AND idempotency_key = $2`,
        [organizationId, key],
      );
      return res.rows[0] ? appointmentFrom(res.rows[0]) : null;
    },
    async insertIfFree(row, bufferMinutes) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`sched:${row.organizationId}`]);
        if (row.idempotencyKey) {
          const existing = await client.query(
            `SELECT * FROM tc_schedule_appointments WHERE organization_id = $1 AND idempotency_key = $2`,
            [row.organizationId, row.idempotencyKey],
          );
          if (existing.rows[0]) {
            await client.query("COMMIT");
            return appointmentFrom(existing.rows[0]);
          }
        }
        const pad = `${bufferMinutes} minutes`;
        const clash = await client.query(
          `SELECT id FROM tc_schedule_appointments
           WHERE organization_id = $1
             AND (
               status = 'confirmed'
               OR (status = 'hold' AND hold_expires_at > now())
             )
             AND start_at - $4::interval < $3::timestamptz
             AND end_at + $4::interval > $2::timestamptz
             AND (
               $5::text IS NULL OR technician_id IS NULL OR technician_id = $5
             )`,
          [row.organizationId, row.startAt, row.endAt, pad, row.technicianId ?? null],
        );
        if (clash.rows.length > 0) {
          await client.query("ROLLBACK");
          return null;
        }
        await writeAppointment(row, client);
        await client.query("COMMIT");
        return row;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async saveAppointment(row) {
      await writeAppointment(row);
    },
    async addEvent(input) {
      await pool.query(
        `INSERT INTO tc_appointment_events (id, organization_id, appointment_id, kind, detail, at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [createId("aevt"), input.organizationId, input.appointmentId, input.kind, input.detail ?? null, input.at],
      );
    },
    async listEvents(organizationId, appointmentId) {
      const res = await pool.query(
        `SELECT kind, detail, at FROM tc_appointment_events
         WHERE organization_id = $1 AND appointment_id = $2 ORDER BY at`,
        [organizationId, appointmentId],
      );
      return res.rows.map((row) => ({
        kind: String(row.kind),
        detail: row.detail ? String(row.detail) : undefined,
        at: new Date(String(row.at)).toISOString(),
      }));
    },
    async getConnection(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_calendar_connections WHERE organization_id = $1`,
        [organizationId],
      );
      const row = res.rows[0];
      if (!row) return null;
      return {
        organizationId,
        provider: "google",
        status: row.status,
        calendarId: row.calendar_id ?? undefined,
        calendarSummary: row.calendar_summary ?? undefined,
        accountEmail: row.account_email ?? undefined,
        expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : undefined,
        lastError: row.last_error ?? undefined,
        tokenCiphertext: row.token_ciphertext ?? undefined,
        scope: row.scope ?? undefined,
      } satisfies StoredConnection;
    },
    async saveConnection(row) {
      await pool.query(
        `INSERT INTO tc_calendar_connections (
          organization_id, provider, status, calendar_id, calendar_summary, account_email,
          token_ciphertext, scope, expires_at, last_error, updated_at
        ) VALUES ($1,'google',$2,$3,$4,$5,$6,$7,$8,$9,now())
        ON CONFLICT (organization_id) DO UPDATE SET
          status = EXCLUDED.status,
          calendar_id = EXCLUDED.calendar_id,
          calendar_summary = EXCLUDED.calendar_summary,
          account_email = EXCLUDED.account_email,
          token_ciphertext = COALESCE(EXCLUDED.token_ciphertext, tc_calendar_connections.token_ciphertext),
          scope = COALESCE(EXCLUDED.scope, tc_calendar_connections.scope),
          expires_at = EXCLUDED.expires_at,
          last_error = EXCLUDED.last_error,
          updated_at = now()`,
        [
          row.organizationId, row.status, row.calendarId ?? null, row.calendarSummary ?? null,
          row.accountEmail ?? null, row.tokenCiphertext ?? null, row.scope ?? null,
          row.expiresAt ?? null, row.lastError ?? null,
        ],
      );
    },
    async replaceBusy(organizationId, blocks: BusyBlock[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM tc_calendar_busy WHERE organization_id = $1`, [organizationId]);
        for (const block of blocks) {
          await client.query(
            `INSERT INTO tc_calendar_busy (id, organization_id, start_at, end_at, external_id)
             VALUES ($1,$2,$3,$4,$5)`,
            [createId("busy"), organizationId, block.startAt, block.endAt, block.externalId ?? null],
          );
        }
        await client.query(
          `INSERT INTO tc_calendar_sync_state (organization_id, last_synced_at)
           VALUES ($1, now())
           ON CONFLICT (organization_id) DO UPDATE SET last_synced_at = now()`,
          [organizationId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async listBusy(organizationId) {
      const res = await pool.query(
        `SELECT start_at, end_at, external_id FROM tc_calendar_busy WHERE organization_id = $1`,
        [organizationId],
      );
      return res.rows.map((row) => ({
        startAt: new Date(String(row.start_at)).toISOString(),
        endAt: new Date(String(row.end_at)).toISOString(),
        externalId: row.external_id ? String(row.external_id) : undefined,
      }));
    },
  };
}
