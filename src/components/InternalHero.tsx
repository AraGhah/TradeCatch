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
    <section className="bg-navy pt-[clamp(72px,8vw,100px)] pb-[clamp(56px,6vw,80px)]">
      <Container>
        <div
          className={`grid items-end gap-x-[clamp(32px,5vw,64px)] gap-y-8 ${
            aside ? "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]" : ""
          }`}
        >
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[13px] font-medium text-orange">{eyebrow}</p>
            ) : null}
            <h1
              className="mt-3 max-w-[820px] font-heading font-extrabold text-white"
              style={{
                fontSize: "clamp(32px, 4.2vw, 52px)",
                lineHeight: 1.05,
                letterSpacing: "-0.042em",
              }}
            >
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
