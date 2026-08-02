"use client";

import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Client-only navigation primitives. Server code must import getPathname from
 * `@/i18n/pathname` so usePathname never resolves to the server stub.
 */
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
