"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client plumbing for the administration console: one way to call the admin API,
 * one way to load data (with loading / error / refresh / stale-while-loading),
 * and one way to run a change (never two at once).
 */

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly fields: string[] = [],
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

type FetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function adminFetch<T>(
  url: string,
  options: FetchOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      cache: "no-store",
      signal: options.signal,
      credentials: "same-origin",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw error;
    throw new AdminApiError("network", 0);
  }
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string; fields?: string[] })
    | null;
  if (!response.ok || !body) {
    throw new AdminApiError(
      body?.error ?? "error",
      response.status,
      typeof body?.code === "string" ? body.code : null,
      Array.isArray(body?.fields) ? body.fields : [],
    );
  }
  return body;
}

export const isAbort = (error: unknown) =>
  (error as { name?: string } | null)?.name === "AbortError";

type Result<T> = {
  key: string;
  data?: T;
  error?: AdminApiError;
  at?: number;
};

export type AdminData<T> = {
  /** The most recent data, kept on screen while the next request is in flight. */
  data: T | undefined;
  /** The error from the latest request, if it failed. */
  error: AdminApiError | undefined;
  /** True until the latest request has answered. */
  loading: boolean;
  /** When the data on screen was fetched (ms since epoch). */
  updatedAt: number | undefined;
  refresh: () => void;
};

/**
 * Loads `url` and reloads when it changes or `refresh()` is called. A newer
 * request supersedes an older one (the older answer is dropped, never shown), so
 * fast filter changes cannot leave stale rows on screen. Pass `autoRefreshMs`
 * for views that should stay current; it pauses while the tab is hidden.
 */
export function useAdminData<T>(
  url: string | null,
  options: { autoRefreshMs?: number } = {},
): AdminData<T> {
  const [result, setResult] = useState<Result<T>>();
  const [tick, setTick] = useState(0);
  const key = `${url ?? ""}#${tick}`;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    adminFetch<T>(url, { signal: controller.signal }).then(
      (data) => setResult({ key, data, at: Date.now() }),
      (error: unknown) => {
        if (isAbort(error)) return;
        setResult((previous) => ({
          key,
          // Keep the last good data so a failed refresh does not blank the page.
          data: previous?.data,
          at: previous?.at,
          error: error instanceof AdminApiError ? error : new AdminApiError("error", 0),
        }));
      },
    );
    return () => controller.abort();
  }, [url, key]);

  const interval = options.autoRefreshMs;
  useEffect(() => {
    if (!interval) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setTick((n) => n + 1);
    }, interval);
    return () => clearInterval(timer);
  }, [interval]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return {
    data: result?.data,
    error: result?.key === key ? result.error : undefined,
    loading: Boolean(url) && result?.key !== key,
    updatedAt: result?.at,
    refresh,
  };
}

export type ActionState = {
  pending: boolean;
  error: AdminApiError | undefined;
  /**
   * Runs `work` unless one is already running. Resolves to its value, or
   * undefined when it failed (the error is in `error`, and passed to `onError`
   * so the caller can react to it immediately rather than on the next render).
   */
  run: <R>(
    work: () => Promise<R>,
    onError?: (error: AdminApiError) => void,
  ) => Promise<R | undefined>;
  reset: () => void;
};

/**
 * One change at a time. A second click while the first is running does nothing
 * (checked on a ref, so it holds even between two clicks in the same tick, before
 * React has re-rendered the disabled button).
 */
export function useAdminAction(): ActionState {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AdminApiError>();

  const run = useCallback(async <R,>(work: () => Promise<R>, onError?: (error: AdminApiError) => void) => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      return await work();
    } catch (caught) {
      const failure = caught instanceof AdminApiError ? caught : new AdminApiError("error", 0);
      setError(failure);
      onError?.(failure);
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(undefined), []);
  return { pending, error, run, reset };
}

export type AdminMe = {
  ok: true;
  role: "super_admin" | "support" | "read_only";
  permissions: string[];
  via: "ops" | "session";
  label: string;
};

/** The signed-in administrator's role. `can()` is false until it is known. */
export function useAdminPermissions() {
  const { data } = useAdminData<AdminMe>("/api/admin/me");
  const can = useCallback(
    (permission: string) => Boolean(data?.permissions.includes(permission)),
    [data],
  );
  return { role: data?.role, can, known: Boolean(data) };
}

/** Debounces a fast-changing value (a search box) so each keystroke is not a request. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function queryString(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(name, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
