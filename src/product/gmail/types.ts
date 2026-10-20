export type GmailAccountStatus = "connected" | "needs_reconnect";

/** Why the last sync failed. Stored in `lastError` and shown to the user. */
export type GmailFailureKind =
  "needs_reconnect" | "rate_limited" | "sync_failed" | "config_error";

export type GmailDirection = "inbound" | "outbound";

export type GmailAttachment = {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  /** Stable MIME part id; Gmail may hand out a different attachmentId per fetch. */
  partId: string;
};

export type GmailAccount = {
  id: string;
  organizationId: string;
  userId: string;
  email: string | null;
  status: GmailAccountStatus;
  /** AES-256-GCM sealed OAuth tokens. Never leaves the server. */
  tokenCiphertext: string | null;
  historyId: string | null;
  watchExpiration: string | null;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  nextSyncAt: string | null;
  failureCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  unread: boolean;
  hasAttachments: boolean;
  /** A real person wrote this (not automated or bulk mail). */
  important: boolean;
  direction: GmailDirection;
};

export type GmailMessage = GmailMessageSummary & {
  organizationId: string;
  userId: string;
  accountId: string;
  gmailId: string;
  bodyText: string | null;
  attachments: GmailAttachment[];
  createdAt: string;
};

export type GmailPublicStatus = {
  configured: boolean;
  pushConfigured: boolean;
  pushEnabled: boolean;
  status: GmailAccountStatus | "not_connected";
  email: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  unread: number;
};

export type ParsedGmailMessage = Omit<
  GmailMessage,
  "id" | "organizationId" | "userId" | "accountId" | "createdAt"
>;
