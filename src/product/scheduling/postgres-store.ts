import { createId } from "@/lib/id";
import type { Pool } from "pg";
import { getPgPool } from "@/lib/postgres-pool";
import type {
  CalcomBookingRecord,
  CalcomConnection,
  CalcomRoute,
} from "./calcom/types";
import type { EventLink, ExternalEvent, SyncState } from "./gcal/types";
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
    maxDailyBookings:
      row.max_daily_bookings == null
        ? undefined
        : Number(row.max_daily_bookings),
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
    bufferMinutes:
      row.buffer_minutes == null ? undefined : Number(row.buffer_minutes),
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
    customerPhoneE164: row.customer_phone_e164
      ? String(row.customer_phone_e164)
      : undefined,
    customerEmail: row.customer_email ? String(row.customer_email) : undefined,
    serviceAddress: row.service_address
      ? String(row.service_address)
      : undefined,
    serviceId: row.service_id ? String(row.service_id) : undefined,
    serviceName: String(row.service_name),
    technicianId: row.technician_id ? String(row.technician_id) : undefined,
    technicianName: row.technician_name
      ? String(row.technician_name)
      : undefined,
    leadId: row.lead_id ? String(row.lead_id) : undefined,
    startAt: new Date(String(row.start_at)).toISOString(),
    endAt: new Date(String(row.end_at)).toISOString(),
    timezone: String(row.timezone),
    status: row.status as ScheduleAppointment["status"],
    bookingSource: row.booking_source as ScheduleAppointment["bookingSource"],
    appointmentKind:
      row.appointment_kind as ScheduleAppointment["appointmentKind"],
    calendarEventId: row.calendar_event_id
      ? String(row.calendar_event_id)
      : undefined,
    idempotencyKey: row.idempotency_key
      ? String(row.idempotency_key)
      : undefined,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : undefined,
    simulated: Boolean(row.simulated),
    holdExpiresAt: row.hold_expires_at
      ? new Date(String(row.hold_expires_at)).toISOString()
      : undefined,
    confirmationNoticesPending: Boolean(row.confirmation_notices_pending),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function createPostgresSchedulingStore(
  connectionString: string,
): SchedulingStore {
  const pool = getPgPool(connectionString);

  async function writeMirror(
    client: { query: Pool["query"] },
    organizationId: string,
    calendarId: string,
    events: ExternalEvent[],
  ) {
    for (const event of events) {
      await client.query(
        `INSERT INTO tc_gcal_events (
          organization_id, calendar_id, event_id, start_at, end_at, all_day,
          transparent, status, declined, informational, etag, appointment_id, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
        ON CONFLICT (organization_id, calendar_id, event_id) DO UPDATE SET
          start_at = EXCLUDED.start_at,
          end_at = EXCLUDED.end_at,
          all_day = EXCLUDED.all_day,
          transparent = EXCLUDED.transparent,
          status = EXCLUDED.status,
          declined = EXCLUDED.declined,
          informational = EXCLUDED.informational,
          etag = EXCLUDED.etag,
          appointment_id = EXCLUDED.appointment_id,
          updated_at = now()`,
        [
          organizationId,
          calendarId,
          event.eventId,
          event.startAt,
          event.endAt,
          event.allDay,
          event.transparent,
          event.status,
          event.declined,
          event.informational,
          event.etag ?? null,
          event.appointmentId ?? null,
        ],
      );
    }
  }

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
        created_at, updated_at, confirmation_notices_pending
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
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
        confirmation_notices_pending = EXCLUDED.confirmation_notices_pending,
        updated_at = EXCLUDED.updated_at
      -- A save can only ever change a row of its own business, whatever id it
      -- is given: the memory store has always refused the same thing.
      WHERE tc_schedule_appointments.organization_id = EXCLUDED.organization_id`,
      [
        row.id,
        row.organizationId,
        row.customerName ?? null,
        row.customerPhoneE164 ?? null,
        row.customerEmail ?? null,
        row.serviceAddress ?? null,
        row.serviceId ?? null,
        row.serviceName,
        row.technicianId ?? null,
        row.technicianName ?? null,
        row.leadId ?? null,
        row.startAt,
        row.endAt,
        row.timezone,
        row.status,
        row.bookingSource,
        row.appointmentKind,
        row.calendarEventId ?? null,
        row.idempotencyKey ?? null,
        row.cancelReason ?? null,
        row.simulated,
        row.holdExpiresAt ?? null,
        row.createdAt,
        row.updatedAt,
        row.confirmationNoticesPending ?? false,
      ],
    );
  }

  return {
    async listPendingConfirmations(limit) {
      const result = await pool.query(
        `SELECT * FROM tc_schedule_appointments
        WHERE status = 'confirmed' AND confirmation_notices_pending
        ORDER BY updated_at, id LIMIT $1`,
        [limit],
      );
      return result.rows.map(appointmentFrom);
    },
    async completeConfirmation(organizationId, id, startAt) {
      await pool.query(
        `UPDATE tc_schedule_appointments SET confirmation_notices_pending = false
        WHERE organization_id = $1 AND id = $2 AND start_at = $3 AND status = 'confirmed'`,
        [organizationId, id, startAt],
      );
    },
    async getRules(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_availability_rules WHERE organization_id = $1`,
        [organizationId],
      );
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
          rules.organizationId,
          rules.timezone,
          JSON.stringify(rules.days),
          rules.defaultDurationMinutes,
          rules.bufferMinutes,
          rules.travelBufferMinutes,
          rules.minimumNoticeMinutes,
          rules.maxAdvanceDays,
          rules.maxDailyBookings ?? null,
          JSON.stringify(rules.holidays),
          rules.calendarMode,
          rules.updatedAt,
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
          service.id,
          service.organizationId,
          service.name,
          service.description ?? null,
          service.durationMinutes,
          service.bufferMinutes ?? null,
          service.bookingMode,
          JSON.stringify(service.eligibleTechnicianIds),
          service.serviceArea ?? null,
          service.active,
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
        [
          technician.id,
          technician.organizationId,
          technician.name,
          technician.serviceArea ?? null,
          technician.active,
        ],
      );
      return technician;
    },
    async listAppointments(organizationId, limit) {
      const res = await pool.query(
        "SELECT * FROM tc_schedule_appointments WHERE organization_id=$1 ORDER BY start_at LIMIT $2",
        [organizationId, limit ?? null],
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
    async insertIfFree(row, bufferMinutes, ignoreAppointmentId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `sched:${row.organizationId}`,
        ]);
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
             )
             AND ($6::text IS NULL OR id <> $6)`,
          [
            row.organizationId,
            row.startAt,
            row.endAt,
            pad,
            row.technicianId ?? null,
            ignoreAppointmentId ?? null,
          ],
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
        [
          createId("aevt"),
          input.organizationId,
          input.appointmentId,
          input.kind,
          input.detail ?? null,
          input.at,
        ],
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
        expiresAt: row.expires_at
          ? new Date(String(row.expires_at)).toISOString()
          : undefined,
        lastError: row.last_error ?? undefined,
        tokenCiphertext: row.token_ciphertext ?? undefined,
        scope: row.scope ?? undefined,
        eventDetail: row.event_detail === "standard" ? "standard" : "minimal",
        cancelPolicy:
          row.cancel_policy === "mark_canceled" ? "mark_canceled" : "remove",
        connectedAt: isoOrUndefined(row.connected_at),
      } satisfies StoredConnection;
    },
    async saveConnection(row) {
      await pool.query(
        `INSERT INTO tc_calendar_connections (
          organization_id, provider, status, calendar_id, calendar_summary, account_email,
          token_ciphertext, scope, expires_at, last_error, event_detail, cancel_policy,
          connected_at, updated_at
        ) VALUES ($1,'google',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
        ON CONFLICT (organization_id) DO UPDATE SET
          status = EXCLUDED.status,
          calendar_id = EXCLUDED.calendar_id,
          calendar_summary = EXCLUDED.calendar_summary,
          account_email = EXCLUDED.account_email,
          -- A disconnected business keeps no credential. Every other save that
          -- carries no token (a status change) keeps the one on file.
          token_ciphertext = CASE
            WHEN EXCLUDED.status = 'disconnected' THEN NULL
            ELSE COALESCE(EXCLUDED.token_ciphertext, tc_calendar_connections.token_ciphertext)
          END,
          scope = CASE
            WHEN EXCLUDED.status = 'disconnected' THEN NULL
            ELSE COALESCE(EXCLUDED.scope, tc_calendar_connections.scope)
          END,
          expires_at = EXCLUDED.expires_at,
          last_error = EXCLUDED.last_error,
          event_detail = EXCLUDED.event_detail,
          cancel_policy = EXCLUDED.cancel_policy,
          connected_at = EXCLUDED.connected_at,
          updated_at = now()`,
        [
          row.organizationId,
          row.status,
          row.calendarId ?? null,
          row.calendarSummary ?? null,
          row.accountEmail ?? null,
          row.tokenCiphertext ?? null,
          row.scope ?? null,
          row.expiresAt ?? null,
          row.lastError ?? null,
          row.eventDetail ?? "minimal",
          row.cancelPolicy ?? "remove",
          row.connectedAt ?? null,
        ],
      );
    },
    async replaceBusy(organizationId, blocks: BusyBlock[]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM tc_calendar_busy WHERE organization_id = $1`,
          [organizationId],
        );
        for (const block of blocks) {
          await client.query(
            `INSERT INTO tc_calendar_busy (id, organization_id, start_at, end_at, external_id)
             VALUES ($1,$2,$3,$4,$5)`,
            [
              createId("busy"),
              organizationId,
              block.startAt,
              block.endAt,
              block.externalId ?? null,
            ],
          );
        }
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

    async getEventLink(organizationId, appointmentId) {
      const res = await pool.query(
        `SELECT * FROM tc_gcal_event_links
         WHERE organization_id = $1 AND appointment_id = $2`,
        [organizationId, appointmentId],
      );
      return res.rows[0] ? eventLinkFrom(res.rows[0]) : null;
    },
    async findEventLinkByEventId(organizationId, calendarId, eventId) {
      const res = await pool.query(
        `SELECT * FROM tc_gcal_event_links
         WHERE organization_id = $1 AND calendar_id = $2 AND event_id = $3`,
        [organizationId, calendarId, eventId],
      );
      return res.rows[0] ? eventLinkFrom(res.rows[0]) : null;
    },
    async saveEventLink(link) {
      await pool.query(
        `INSERT INTO tc_gcal_event_links (
          organization_id, appointment_id, calendar_id, event_id, generation, state,
          pending_op, attempts, next_attempt_at, last_error, last_synced_at, remote_etag,
          synced_start_at, synced_end_at, external_start_at, external_end_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
        ON CONFLICT (organization_id, appointment_id) DO UPDATE SET
          calendar_id = EXCLUDED.calendar_id,
          event_id = EXCLUDED.event_id,
          generation = EXCLUDED.generation,
          state = EXCLUDED.state,
          pending_op = EXCLUDED.pending_op,
          attempts = EXCLUDED.attempts,
          next_attempt_at = EXCLUDED.next_attempt_at,
          last_error = EXCLUDED.last_error,
          last_synced_at = EXCLUDED.last_synced_at,
          remote_etag = EXCLUDED.remote_etag,
          synced_start_at = EXCLUDED.synced_start_at,
          synced_end_at = EXCLUDED.synced_end_at,
          external_start_at = EXCLUDED.external_start_at,
          external_end_at = EXCLUDED.external_end_at,
          updated_at = now()`,
        [
          link.organizationId,
          link.appointmentId,
          link.calendarId,
          link.eventId,
          link.generation,
          link.state,
          link.pendingOp,
          link.attempts,
          link.nextAttemptAt ?? null,
          link.lastError ?? null,
          link.lastSyncedAt ?? null,
          link.remoteEtag ?? null,
          link.syncedStartAt ?? null,
          link.syncedEndAt ?? null,
          link.externalStartAt ?? null,
          link.externalEndAt ?? null,
        ],
      );
    },
    async listEventLinks(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_gcal_event_links WHERE organization_id = $1`,
        [organizationId],
      );
      return res.rows.map(eventLinkFrom);
    },
    async claimEventLinks(query) {
      const res = await pool.query(
        `WITH due AS (
           SELECT organization_id, appointment_id
           FROM tc_gcal_event_links
           WHERE state = 'pending' AND pending_op IS NOT NULL
             AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
             AND ($2::text IS NULL OR organization_id = $2)
             AND ($3::text IS NULL OR appointment_id = $3)
           ORDER BY COALESCE(next_attempt_at, updated_at)
           LIMIT $4
           FOR UPDATE SKIP LOCKED
         )
         UPDATE tc_gcal_event_links l
         SET next_attempt_at = $5
         FROM due
         WHERE l.organization_id = due.organization_id
           AND l.appointment_id = due.appointment_id
         RETURNING l.*`,
        [
          query.now.toISOString(),
          query.organizationId ?? null,
          query.appointmentId ?? null,
          query.limit,
          new Date(query.now.getTime() + query.leaseMs).toISOString(),
        ],
      );
      return res.rows.map(eventLinkFrom);
    },
    async getSyncState(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_calendar_sync_state WHERE organization_id = $1`,
        [organizationId],
      );
      return res.rows[0] ? syncStateFrom(res.rows[0]) : null;
    },
    async saveSyncState(state) {
      await pool.query(
        `INSERT INTO tc_calendar_sync_state (
          organization_id, calendar_id, sync_token, channel_token_hash, channel_id,
          resource_id, channel_expires_at, last_message_number, last_synced_at,
          last_full_sync_at, last_error, consecutive_failures, next_attempt_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (organization_id) DO UPDATE SET
          calendar_id = EXCLUDED.calendar_id,
          sync_token = EXCLUDED.sync_token,
          channel_token_hash = EXCLUDED.channel_token_hash,
          channel_id = EXCLUDED.channel_id,
          resource_id = EXCLUDED.resource_id,
          channel_expires_at = EXCLUDED.channel_expires_at,
          last_message_number = EXCLUDED.last_message_number,
          last_synced_at = EXCLUDED.last_synced_at,
          last_full_sync_at = EXCLUDED.last_full_sync_at,
          last_error = EXCLUDED.last_error,
          consecutive_failures = EXCLUDED.consecutive_failures,
          next_attempt_at = EXCLUDED.next_attempt_at`,
        [
          state.organizationId,
          state.calendarId ?? null,
          state.syncToken ?? null,
          state.channelTokenHash ?? null,
          state.channelId ?? null,
          state.resourceId ?? null,
          state.channelExpiresAt ?? null,
          state.lastMessageNumber ?? null,
          state.lastSyncedAt ?? null,
          state.lastFullSyncAt ?? null,
          state.lastError ?? null,
          state.consecutiveFailures,
          state.nextAttemptAt ?? null,
        ],
      );
    },
    async findSyncStateByChannel(channelId) {
      const res = await pool.query(
        `SELECT * FROM tc_calendar_sync_state WHERE channel_id = $1`,
        [channelId],
      );
      return res.rows[0] ? syncStateFrom(res.rows[0]) : null;
    },
    async listSyncStates() {
      const res = await pool.query(
        `SELECT * FROM tc_calendar_sync_state WHERE calendar_id IS NOT NULL`,
      );
      return res.rows.map(syncStateFrom);
    },
    async tryLease(organizationId, now, until) {
      const res = await pool.query(
        `INSERT INTO tc_calendar_sync_state (organization_id, lease_until)
         VALUES ($1, $3)
         ON CONFLICT (organization_id) DO UPDATE SET lease_until = EXCLUDED.lease_until
         WHERE tc_calendar_sync_state.lease_until IS NULL
            OR tc_calendar_sync_state.lease_until <= $2
         RETURNING organization_id`,
        [organizationId, now.toISOString(), until.toISOString()],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async releaseLease(organizationId) {
      await pool.query(
        `UPDATE tc_calendar_sync_state SET lease_until = NULL WHERE organization_id = $1`,
        [organizationId],
      );
    },
    async requestRerun(organizationId) {
      await pool.query(
        `INSERT INTO tc_calendar_sync_state (organization_id, rerun_requested)
         VALUES ($1, true)
         ON CONFLICT (organization_id) DO UPDATE SET rerun_requested = true`,
        [organizationId],
      );
    },
    async consumeRerun(organizationId) {
      const res = await pool.query(
        `UPDATE tc_calendar_sync_state SET rerun_requested = false
         WHERE organization_id = $1 AND rerun_requested = true
         RETURNING organization_id`,
        [organizationId],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async listMirror(organizationId, calendarId) {
      const res = await pool.query(
        `SELECT * FROM tc_gcal_events WHERE organization_id = $1 AND calendar_id = $2`,
        [organizationId, calendarId],
      );
      return res.rows.map(mirrorFrom);
    },
    async replaceMirror(organizationId, calendarId, events) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM tc_gcal_events WHERE organization_id = $1`,
          [organizationId],
        );
        await writeMirror(client, organizationId, calendarId, events);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async applyMirror(organizationId, calendarId, upserts, deletedEventIds) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (deletedEventIds.length > 0) {
          await client.query(
            `DELETE FROM tc_gcal_events
             WHERE organization_id = $1 AND calendar_id = $2 AND event_id = ANY($3::text[])`,
            [organizationId, calendarId, deletedEventIds],
          );
        }
        await writeMirror(client, organizationId, calendarId, upserts);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async clearGoogleSync(organizationId, now) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM tc_gcal_events WHERE organization_id = $1`,
          [organizationId],
        );
        await client.query(
          `DELETE FROM tc_calendar_sync_state WHERE organization_id = $1`,
          [organizationId],
        );
        await client.query(
          `DELETE FROM tc_calendar_busy WHERE organization_id = $1`,
          [organizationId],
        );
        await client.query(
          `UPDATE tc_gcal_event_links
           SET state = 'detached', pending_op = NULL, attempts = 0,
               next_attempt_at = NULL, last_error = NULL,
               external_start_at = NULL, external_end_at = NULL, updated_at = $2
           WHERE organization_id = $1`,
          [organizationId, now.toISOString()],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async getCalcomConnection(organizationId) {
      const res = await pool.query(
        `SELECT * FROM tc_calcom_connections WHERE organization_id = $1`,
        [organizationId],
      );
      return res.rows[0] ? calcomConnectionFrom(res.rows[0]) : null;
    },
    async saveCalcomConnection(row) {
      await pool.query(
        `INSERT INTO tc_calcom_connections (
          organization_id, status, credential_kind, credential_ciphertext,
          account_email, account_username, account_timezone,
          default_event_type_id, routes_json, attendee_email,
          last_error, last_verified_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,now())
        ON CONFLICT (organization_id) DO UPDATE SET
          status = EXCLUDED.status,
          credential_kind = EXCLUDED.credential_kind,
          credential_ciphertext = EXCLUDED.credential_ciphertext,
          account_email = EXCLUDED.account_email,
          account_username = EXCLUDED.account_username,
          account_timezone = EXCLUDED.account_timezone,
          default_event_type_id = EXCLUDED.default_event_type_id,
          routes_json = EXCLUDED.routes_json,
          attendee_email = EXCLUDED.attendee_email,
          last_error = EXCLUDED.last_error,
          last_verified_at = EXCLUDED.last_verified_at,
          updated_at = now()`,
        [
          row.organizationId,
          row.status,
          row.credentialKind,
          row.credentialCiphertext ?? null,
          row.accountEmail ?? null,
          row.accountUsername ?? null,
          row.accountTimeZone ?? null,
          row.defaultEventTypeId,
          JSON.stringify(row.routes),
          row.attendeeEmail ?? null,
          row.lastError ?? null,
          row.lastVerifiedAt ?? null,
        ],
      );
    },
    async listCalcomConnections() {
      const res = await pool.query(
        `SELECT * FROM tc_calcom_connections WHERE status <> 'disconnected'`,
      );
      return res.rows.map(calcomConnectionFrom);
    },
    async getCalcomBooking(organizationId, appointmentId) {
      const res = await pool.query(
        `SELECT * FROM tc_calcom_bookings
         WHERE organization_id = $1 AND appointment_id = $2`,
        [organizationId, appointmentId],
      );
      return res.rows[0] ? calcomBookingFrom(res.rows[0]) : null;
    },
    async findCalcomBookingByUid(organizationId, uid) {
      const res = await pool.query(
        `SELECT * FROM tc_calcom_bookings
         WHERE organization_id = $1 AND provider_uid = $2`,
        [organizationId, uid],
      );
      return res.rows[0] ? calcomBookingFrom(res.rows[0]) : null;
    },
    async saveCalcomBooking(row) {
      await pool.query(
        `INSERT INTO tc_calcom_bookings (
          organization_id, appointment_id, event_type_id, state, provider_uid,
          start_at, error_code, attempts, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (organization_id, appointment_id) DO UPDATE SET
          event_type_id = EXCLUDED.event_type_id,
          state = EXCLUDED.state,
          provider_uid = EXCLUDED.provider_uid,
          start_at = EXCLUDED.start_at,
          error_code = EXCLUDED.error_code,
          attempts = EXCLUDED.attempts,
          updated_at = EXCLUDED.updated_at`,
        [
          row.organizationId,
          row.appointmentId,
          row.eventTypeId,
          row.state,
          row.providerUid ?? null,
          row.startAt,
          row.errorCode ?? null,
          row.attempts,
          row.createdAt,
          row.updatedAt,
        ],
      );
    },
    async listCalcomBookings(organizationId, states, limit) {
      const res = await pool.query(
        `SELECT * FROM tc_calcom_bookings
         WHERE organization_id = $1 AND state = ANY($2::text[])
         ORDER BY created_at ASC
         LIMIT $3`,
        [organizationId, states, Math.max(1, Math.min(200, limit))],
      );
      return res.rows.map(calcomBookingFrom);
    },
  };
}

const isoOrUndefined = (value: unknown): string | undefined =>
  value == null ? undefined : new Date(String(value)).toISOString();

function eventLinkFrom(row: Record<string, unknown>): EventLink {
  return {
    organizationId: String(row.organization_id),
    appointmentId: String(row.appointment_id),
    calendarId: String(row.calendar_id),
    eventId: row.event_id == null ? null : String(row.event_id),
    generation: Number(row.generation),
    state: String(row.state) as EventLink["state"],
    pendingOp:
      row.pending_op == null
        ? null
        : (String(row.pending_op) as EventLink["pendingOp"]),
    attempts: Number(row.attempts),
    nextAttemptAt: isoOrUndefined(row.next_attempt_at),
    lastError: row.last_error == null ? undefined : String(row.last_error),
    lastSyncedAt: isoOrUndefined(row.last_synced_at),
    remoteEtag: row.remote_etag == null ? undefined : String(row.remote_etag),
    syncedStartAt: isoOrUndefined(row.synced_start_at),
    syncedEndAt: isoOrUndefined(row.synced_end_at),
    externalStartAt: isoOrUndefined(row.external_start_at),
    externalEndAt: isoOrUndefined(row.external_end_at),
    updatedAt: isoOrUndefined(row.updated_at) ?? new Date().toISOString(),
  };
}

function syncStateFrom(row: Record<string, unknown>): SyncState {
  return {
    organizationId: String(row.organization_id),
    calendarId: row.calendar_id == null ? undefined : String(row.calendar_id),
    syncToken: row.sync_token == null ? undefined : String(row.sync_token),
    channelTokenHash:
      row.channel_token_hash == null ? undefined : String(row.channel_token_hash),
    channelId: row.channel_id == null ? undefined : String(row.channel_id),
    resourceId: row.resource_id == null ? undefined : String(row.resource_id),
    channelExpiresAt: isoOrUndefined(row.channel_expires_at),
    lastMessageNumber:
      row.last_message_number == null ? undefined : Number(row.last_message_number),
    lastSyncedAt: isoOrUndefined(row.last_synced_at),
    lastFullSyncAt: isoOrUndefined(row.last_full_sync_at),
    lastError: row.last_error == null ? undefined : String(row.last_error),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    nextAttemptAt: isoOrUndefined(row.next_attempt_at),
    leaseUntil: isoOrUndefined(row.lease_until),
  };
}

function mirrorFrom(row: Record<string, unknown>): ExternalEvent {
  return {
    eventId: String(row.event_id),
    startAt: new Date(String(row.start_at)).toISOString(),
    endAt: new Date(String(row.end_at)).toISOString(),
    allDay: Boolean(row.all_day),
    transparent: Boolean(row.transparent),
    status: String(row.status) as ExternalEvent["status"],
    declined: Boolean(row.declined),
    informational: Boolean(row.informational),
    etag: row.etag == null ? undefined : String(row.etag),
    appointmentId:
      row.appointment_id == null ? undefined : String(row.appointment_id),
  };
}

function calcomConnectionFrom(row: Record<string, unknown>): CalcomConnection {
  return {
    organizationId: String(row.organization_id),
    status: row.status as CalcomConnection["status"],
    credentialKind: "api_key",
    credentialCiphertext: row.credential_ciphertext
      ? String(row.credential_ciphertext)
      : undefined,
    accountEmail: row.account_email ? String(row.account_email) : undefined,
    accountUsername: row.account_username
      ? String(row.account_username)
      : undefined,
    accountTimeZone: row.account_timezone
      ? String(row.account_timezone)
      : undefined,
    defaultEventTypeId: Number(row.default_event_type_id),
    routes: Array.isArray(row.routes_json)
      ? (row.routes_json as CalcomRoute[])
      : [],
    attendeeEmail: row.attendee_email ? String(row.attendee_email) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    lastVerifiedAt: row.last_verified_at
      ? new Date(String(row.last_verified_at)).toISOString()
      : undefined,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function calcomBookingFrom(row: Record<string, unknown>): CalcomBookingRecord {
  return {
    organizationId: String(row.organization_id),
    appointmentId: String(row.appointment_id),
    eventTypeId: Number(row.event_type_id),
    state: row.state as CalcomBookingRecord["state"],
    providerUid: row.provider_uid ? String(row.provider_uid) : undefined,
    startAt: new Date(String(row.start_at)).toISOString(),
    errorCode: row.error_code ? String(row.error_code) : undefined,
    attempts: Number(row.attempts),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
