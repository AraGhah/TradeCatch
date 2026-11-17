"use client";

import { useEffect } from "react";
import { setBusinessAnalytics } from "@/lib/analytics";

/**
 * Tells the site-wide analytics loader whether this business allows usage
 * analytics in its dashboard (privacy setting analyticsEnabled). Renders
 * nothing.
 */
export function BusinessAnalyticsFlag({ allowed }: { allowed: boolean }) {
  useEffect(() => {
    setBusinessAnalytics(allowed);
    return () => setBusinessAnalytics(undefined);
  }, [allowed]);
  return null;
}
