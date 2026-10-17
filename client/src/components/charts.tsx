import type { ReactNode } from "react";

/**
 * Hand-rolled chart primitives shared by the finance + dashboard rebuilds.
 *
 * Color-agnostic: donut segment colors arrive as props, so there are no
 * design-token imports here. Deliberately dependency-free (no animation or
 * 3D libraries) so the eager/POS entry chunk never pulls them in. The donut
 * is the SVG primitive (stroke-dasharray ring); the bars are plain CSS
 * heights/widths, which keeps them fluid without measuring the DOM.
 */

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

export type BarItem = {
  label: string;
  value: number;
};

const defaultFormat = (value: number) => String(value);

/** Integer share of `total`; 0 when there is nothing to divide by. */
const percent = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 100) : 0;

/**
 * SVG ring split by `segments`, paired with a legend listing every segment's
 * label, `formatValue(value)`, and integer percent. A zero total renders
 * `emptyMessage` instead of the ring.
 */
export function Donut({
  segments,
  size = 160,
  centerLabel,
  formatValue = defaultFormat,
  emptyMessage = "No data yet.",
}: {
  segments: DonutSegment[];
  size?: number;
  centerLabel?: ReactNode;
  formatValue?: (value: number) => string;
  emptyMessage?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  if (total <= 0) {
    return <p className="py-6 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  const strokeWidth = Math.round(size * 0.1);
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          role="img"
          aria-label="Breakdown"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-ink/10"
          />
          {segments.map((segment, index) => {
            if (segment.value <= 0) return null;
            const length = (segment.value / total) * circumference;
            const dashOffset = -offset;
            offset += length;
            return (
              <circle
                key={`${segment.label}-${index}`}
                data-segment={segment.label}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${center} ${center})`}
              >
                <title>{`${segment.label}: ${percent(segment.value, total)}%`}</title>
              </circle>
            );
          })}
        </svg>
        {centerLabel ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerLabel}
          </div>
        ) : null}
      </div>
      <ul className="flex min-w-0 flex-col gap-2 text-sm">
        {segments.map((segment, index) => (
          <li key={`${segment.label}-${index}`} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: segment.color }}
            />
            <span className="text-ink">{segment.label}</span>
            <span className="text-muted">{formatValue(segment.value)}</span>
            <span className="ml-auto pl-3 font-semibold text-ink">
              {percent(segment.value, total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bar chart. `vertical` draws a column per item (value above, 10px label
 * below); `horizontal` draws ranked rows (label left, bar, value right).
 * Rows keep the caller's order — sort upstream for a ranking. Empty or
 * all-zero data renders `emptyMessage`.
 */
export function Bars({
  items,
  orientation = "vertical",
  formatValue = defaultFormat,
  emptyMessage = "No data yet.",
}: {
  items: BarItem[];
  orientation?: "vertical" | "horizontal";
  formatValue?: (value: number) => string;
  emptyMessage?: string;
}) {
  const max = items.reduce((peak, item) => Math.max(peak, item.value), 0);

  if (max <= 0) {
    return <p className="py-6 text-center text-sm text-muted">{emptyMessage}</p>;
  }

  const share = (value: number) => `${(value / max) * 100}%`;

  if (orientation === "horizontal") {
    return (
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            data-row=""
            className="flex items-center gap-3 text-sm"
          >
            <span
              data-label=""
              className="w-24 shrink-0 truncate text-muted"
            >
              {item.label}
            </span>
            <span className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/5">
              <span
                data-bar=""
                className="block h-full rounded-full bg-accent"
                style={{ width: share(item.value) }}
              />
            </span>
            <span
              data-value=""
              className="shrink-0 text-right font-semibold text-ink"
            >
              {formatValue(item.value)}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex items-end gap-1">
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
        >
          <span data-value="" className="text-[10px] font-semibold text-muted">
            {formatValue(item.value)}
          </span>
          <span className="flex h-24 w-full items-end">
            <span
              data-bar=""
              className="block w-full rounded-t bg-accent"
              style={{ height: share(item.value) }}
            />
          </span>
          <span
            data-label=""
            className="w-full truncate text-center text-[10px] text-muted"
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
