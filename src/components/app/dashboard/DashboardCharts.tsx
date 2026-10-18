"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { DashboardSeriesPoint } from "@/product/saas/dashboard-overview";
import { formatDay } from "@/components/app/dashboard/format";

const WIDTH = 640;
const HEIGHT = 220;
const PAD_X = 36;
const PAD_Y = 24;

export function DashboardCharts({
  points,
  outcomes,
}: {
  points: DashboardSeriesPoint[];
  outcomes: { key: string; count: number }[];
}) {
  const t = useTranslations("app.home");
  const locale = useLocale() === "fr" ? "fr" : "en";
  const [hover, setHover] = useState<number | null>(null);
  const [hidden, setHidden] = useState({ calls: false, leads: false, appointments: false });

  const series = [
    { key: "calls" as const, label: t("chart.calls"), color: "var(--color-navy)" },
    { key: "leads" as const, label: t("chart.leads"), color: "var(--color-orange)" },
    { key: "appointments" as const, label: t("chart.appointments"), color: "var(--color-green)" },
  ];
  const visible = series.filter((item) => points.some((point) => point[item.key] != null));
  const drawn = visible.filter((item) => !hidden[item.key]);
  const max = Math.max(
    1,
    ...points.flatMap((point) =>
      drawn.map((item) => point[item.key] ?? 0),
    ),
  );
  const hasPoints = points.length > 0 && drawn.some((item) => points.some((point) => (point[item.key] ?? 0) > 0));
  const hovered = hover != null ? points[hover] : null;

  function xAt(index: number) {
    if (points.length <= 1) return WIDTH / 2;
    return PAD_X + (index / (points.length - 1)) * (WIDTH - PAD_X * 2);
  }
  function yAt(value: number) {
    return HEIGHT - PAD_Y - (value / max) * (HEIGHT - PAD_Y * 2);
  }

  function move(event: React.MouseEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    if (points.length === 1) {
      setHover(0);
      return;
    }
    const ratio = (local.x - PAD_X) / (WIDTH - PAD_X * 2);
    const index = Math.round(Math.min(1, Math.max(0, ratio)) * (points.length - 1));
    setHover(index);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.8fr)]">
      <section className="rounded-xl border border-navy/10 bg-white p-4 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-[family-name:var(--font-archivo)] text-base font-extrabold text-navy">
            {t("chart.title")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {visible.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={!hidden[item.key]}
                onClick={() => setHidden((current) => ({ ...current, [item.key]: !current[item.key] }))}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  hidden[item.key] ? "border-navy/10 text-navy/70" : "border-navy/15 text-navy"
                }`}
              >
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                  style={{ background: item.color }}
                />
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {!hasPoints ? (
          <p className="mt-8 mb-6 text-center text-sm text-navy/70">{t("chart.empty")}</p>
        ) : (
          <div className="relative mt-3">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-56 w-full"
              role="img"
              aria-label={t("chart.title")}
              onMouseMove={move}
              onMouseLeave={() => setHover(null)}
            >
              {[0, 0.5, 1].map((step) => {
                const y = yAt(max * step);
                return (
                  <g key={step}>
                    <line x1={PAD_X} x2={WIDTH - PAD_X} y1={y} y2={y} stroke="rgb(12 20 30 / 0.08)" />
                    <text x={4} y={y + 4} className="fill-navy/50" fontSize="11">
                      {Math.round(max * step)}
                    </text>
                  </g>
                );
              })}
              {drawn.map((item) => {
                const line = points
                  .map((point, index) => {
                    const value = point[item.key];
                    if (value == null) return null;
                    return `${xAt(index)},${yAt(value)}`;
                  })
                  .filter(Boolean)
                  .join(" ");
                return (
                  <g key={item.key}>
                    <polyline
                      fill="none"
                      stroke={item.color}
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      points={line}
                    />
                    {points.map((point, index) => {
                      const value = point[item.key];
                      if (value == null) return null;
                      return (
                        <circle
                          key={`${item.key}-${point.label}`}
                          cx={xAt(index)}
                          cy={yAt(value)}
                          r={hover === index ? 4.5 : 2.5}
                          fill={item.color}
                        />
                      );
                    })}
                  </g>
                );
              })}
              {hovered ? (
                <line
                  x1={xAt(hover ?? 0)}
                  x2={xAt(hover ?? 0)}
                  y1={PAD_Y}
                  y2={HEIGHT - PAD_Y}
                  stroke="rgb(12 20 30 / 0.2)"
                />
              ) : null}
            </svg>
            {hovered ? (
              <div className="pointer-events-none absolute top-2 right-2 rounded-lg border border-navy/10 bg-white/95 px-3 py-2 text-xs shadow-[var(--shadow-card)]">
                <p className="font-semibold text-navy">{formatDay(hovered.label, locale)}</p>
                {drawn.map((item) => (
                  <p key={item.key} className="mt-1 text-navy/80">
                    {item.label}: {hovered[item.key] ?? "—"}
                  </p>
                ))}
              </div>
            ) : null}
            <ul className="sr-only">
              {points.map((point) => (
                <li key={point.label}>
                  {formatDay(point.label, locale)} — {t("chart.calls")} {point.calls ?? "—"},{" "}
                  {t("chart.leads")} {point.leads ?? "—"}, {t("chart.appointments")}{" "}
                  {point.appointments ?? "—"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-navy/10 bg-white p-4 shadow-[var(--shadow-card)]">
        <h2 className="font-[family-name:var(--font-archivo)] text-base font-extrabold text-navy">
          {t("chart.outcomes")}
        </h2>
        {outcomes.length === 0 ? (
          <p className="mt-8 text-sm text-navy/70">{t("chart.empty")}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {outcomes.map((item) => {
              const width = Math.max(6, (item.count / outcomes[0]!.count) * 100);
              return (
                <li key={item.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-navy">{t(`outcomes.${item.key}`)}</span>
                    <span className="font-semibold text-navy">{item.count}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-navy/5">
                    <div
                      className="h-2 rounded-full bg-orange"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
