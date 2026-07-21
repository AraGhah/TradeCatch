import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function PhoneMissedIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M16 3l4 4m0-4l-4 4" />
      <path d="M4 5c0 8.5 6.5 15 15 15a2 2 0 0 0 2-2v-2.2a1 1 0 0 0-.76-.97l-3.2-.8a1 1 0 0 0-1 .27l-1.2 1.2a12 12 0 0 1-5.3-5.3l1.2-1.2a1 1 0 0 0 .27-1l-.8-3.2A1 1 0 0 0 8.2 4H6a2 2 0 0 0-2 1z" />
    </svg>
  );
}

export function MessageIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12a8 8 0 1 1-3.2-6.4L21 4l-1.1 3.6A7.96 7.96 0 0 1 21 12z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

export function TechnicianIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      <path d="M9 21l2-3M15 21l-2-3" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l9.5 17H2.5L12 3z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  );
}

export function QuoteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v3h3M9 11h6M9 14h6M9 17h4" />
    </svg>
  );
}

export function FollowUpIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12a9 9 0 1 1 3 6.7" />
      <path d="M3 21v-5h5" />
      <path d="M12 8v4l2.5 2.5" />
    </svg>
  );
}

export function SignatureIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 17c2-1 3-2 4-4s1-4 2.5-4S11 12 12 14s2 3 3.5 3 2-2 3-4" />
      <path d="M3 21h18" />
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="8" height="6" rx="1" />
      <rect x="13" y="4" width="8" height="10" rx="1" />
      <rect x="3" y="12" width="8" height="8" rx="1" />
      <rect x="13" y="16" width="8" height="4" rx="1" />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M2 20h20" />
    </svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5c0 8.5 6.5 15 15 15a2 2 0 0 0 2-2v-2.2a1 1 0 0 0-.76-.97l-3.2-.8a1 1 0 0 0-1 .27l-1.2 1.2a12 12 0 0 1-5.3-5.3l1.2-1.2a1 1 0 0 0 .27-1l-.8-3.2A1 1 0 0 0 8.2 4H6a2 2 0 0 0-2 1z" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </svg>
  );
}
