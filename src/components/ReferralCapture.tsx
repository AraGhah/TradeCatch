"use client";

import { useEffect } from "react";
import { rememberReferralCode } from "@/lib/referral-capture";

/**
 * Remembers the code from the referral link in this browser (60 days) so the
 * audit form can send it later. Renders nothing; the page explains it.
 */
export function ReferralCapture({ code }: { code: string | null }) {
  useEffect(() => {
    rememberReferralCode(code);
  }, [code]);
  return null;
}
