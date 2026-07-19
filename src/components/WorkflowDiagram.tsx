import {
  PhoneMissedIcon,
  MessageIcon,
  AlertIcon,
  QuoteIcon,
  FollowUpIcon,
  CheckIcon,
} from "@/components/icons";

const STEP_ICONS = [
  PhoneMissedIcon,
  MessageIcon,
  AlertIcon,
  QuoteIcon,
  FollowUpIcon,
  CheckIcon,
];

export function WorkflowDiagram({ caption }: { caption: string }) {
  const labels = caption.split("→").map((s) => s.trim());

  return (
    <div className="rounded-xl border border-navy/10 bg-white p-6 shadow-sm">
      <ol className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-2">
        {labels.map((label, i) => {
          const Icon = STEP_ICONS[i] ?? CheckIcon;
          return (
            <li key={label} className="contents">
              <div className="flex flex-1 items-center gap-3 md:flex-col md:items-center md:text-center">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue/10 text-blue">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium text-text">{label}</span>
              </div>
              {i < labels.length - 1 ? (
                <span aria-hidden className="hidden text-navy/20 md:block">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
