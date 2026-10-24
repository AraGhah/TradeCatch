export type BookingMode =
  "automatic" | "consultation" | "manual_approval" | "escalate";

export type AppointmentStatus =
  "hold" | "pending" | "confirmed" | "completed" | "canceled";

export type CalendarMode = "simulated" | "google" | "internal";

export type CalendarStatus =
  "connected" | "disconnected" | "expired" | "error" | "simulated";

export type DayHours = { open: string; close: string } | null;

export type AvailabilityRules = {
  organizationId: string;
  timezone: string;
  days: Record<string, DayHours>;
  defaultDurationMinutes: number;
  bufferMinutes: number;
  travelBufferMinutes: number;
  minimumNoticeMinutes: number;
  maxAdvanceDays: number;
  maxDailyBookings?: number;
  holidays: string[];
  calendarMode: CalendarMode;
  updatedAt: string;
};

export type ServiceType = {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  bufferMinutes?: number;
  bookingMode: BookingMode;
  eligibleTechnicianIds: string[];
  serviceArea?: string;
  active: boolean;
};

export type Technician = {
  id: string;
  organizationId: string;
  name: string;
  serviceArea?: string;
  active: boolean;
};

export type ScheduleAppointment = {
  id: string;
  organizationId: string;
  customerName?: string;
  customerPhoneE164?: string;
  customerEmail?: string;
  serviceAddress?: string;
  serviceId?: string;
  serviceName: string;
  technicianId?: string;
  technicianName?: string;
  leadId?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  status: AppointmentStatus;
  bookingSource: "ai_receptionist" | "manual" | "dashboard" | "simulation";
  appointmentKind: "job" | "consultation" | "request";
  calendarEventId?: string;
  idempotencyKey?: string;
  cancelReason?: string;
  simulated: boolean;
  holdExpiresAt?: string;
  confirmationNoticesPending?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BusyBlock = { startAt: string; endAt: string; externalId?: string };

export type CalendarConnectionPublic = {
  provider: "google";
  status: CalendarStatus;
  calendarId?: string;
  calendarSummary?: string;
  accountEmail?: string;
  expiresAt?: string;
  lastError?: string;
};

export type Slot = {
  startAt: string;
  endAt: string;
  technicianId?: string;
  technicianName?: string;
  localLabel: string;
};
