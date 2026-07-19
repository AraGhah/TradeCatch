import { useTranslations } from "next-intl";
import { CTAButton } from "@/components/CTAButton";

export function StickyMobileCta() {
  const t = useTranslations("nav");

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-navy/10 bg-white p-3 shadow-[0_-4px_16px_rgba(18,32,51,0.08)] lg:hidden">
      <CTAButton href="/book-audit" className="w-full">
        {t("cta")}
      </CTAButton>
    </div>
  );
}
