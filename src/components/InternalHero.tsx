import { ReactNode } from "react";
import { Container } from "@/components/Container";

/**
 * Compact navy hero for internal pages.
 * Target ~360–480px content band; next section should start soon after.
 */
export function InternalHero({
  eyebrow,
  title,
  intro,
  reassurance,
  aside,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  reassurance?: string;
  aside?: ReactNode;
}) {
  return (
    <section className="bg-navy pt-9 pb-8 sm:pt-[clamp(40px,5vw,64px)] sm:pb-[clamp(36px,4.4vw,56px)]">
      <Container>
        <div
          className={`grid items-end gap-x-[clamp(32px,5vw,64px)] gap-y-8 ${
            aside ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]" : ""
          }`}
        >
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-ui text-[13px] font-medium text-white/60">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="text-page-hero mt-3 max-w-[820px] text-white">
              {title}
            </h1>
            {intro ? (
              <p className="mt-4 max-w-[620px] text-[clamp(15.5px,1.3vw,17.5px)] leading-[1.6] text-white/68">
                {intro}
              </p>
            ) : null}
            {reassurance ? (
              <p className="mt-4 text-[13.5px] text-white/48">{reassurance}</p>
            ) : null}
          </div>
          {aside ? <div className="min-w-0">{aside}</div> : null}
        </div>
      </Container>
    </section>
  );
}
