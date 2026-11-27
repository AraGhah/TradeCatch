import { getTranslations } from "next-intl/server";
import type { LossRecoveryCopy } from "@/components/home/LossRecovery";

/**
 * The before/after strings for the problem section: the three leak cards as
 * written ("without") and their recovered versions ("with"). Shared by the
 * desktop section and the phone layout.
 */
export async function lossRecoveryCopy(): Promise<LossRecoveryCopy> {
  const t = await getTranslations("home");
  const cards = t.raw("leaks.cards") as { title: string; body: string }[];
  const saved = t.raw("lossRecovery.saved") as string[][];
  return {
    label: t("lossRecovery.label"),
    without: t("lossRecovery.without"),
    with: t("lossRecovery.with"),
    lost: t("lossRecovery.lost"),
    recovered: t("lossRecovery.recovered"),
    cards: cards.map((card, i) => ({ ...card, saved: saved[i] ?? [] })),
  };
}
