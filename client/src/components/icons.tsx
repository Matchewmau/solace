import type { ReactNode } from "react";

/**
 * Inline line-art icon set for the global navigation (Task 19).
 *
 * Every icon is a 20×20 SVG stroked with `currentColor` and left unfilled so
 * it inherits text color, and `aria-hidden` because the adjacent label names
 * it. No icon library: this module must stay motion/three-free — it rides the
 * eager chain (see `chunk-guard.test.ts`).
 */

/** Shared props for every icon in the set. */
export type IconProps = { className?: string };

/** The shared 20×20 stroke frame; each export only supplies its paths. */
function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Shopping cart — POS. */
export function CartIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M2 3h2.2l2 9.2a1 1 0 0 0 1 .8h7.2a1 1 0 0 0 1-.8L17 6.5H5.3" />
      <circle cx="8" cy="16.3" r="1.2" />
      <circle cx="15" cy="16.3" r="1.2" />
    </Icon>
  );
}

/** Till receipt — Today / sales history. */
export function ReceiptIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M5 2.5h10v14.5l-2-1.4-2 1.4-2-1.4-2 1.4z" />
      <path d="M7.5 7h5" />
      <path d="M7.5 10.5h5" />
    </Icon>
  );
}

/** Wallet — money / finance. */
export function WalletIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3" y="5.5" width="14" height="9" rx="2" />
      <path d="M13 8.5h4v3h-4a1.5 1.5 0 0 1 0-3z" />
    </Icon>
  );
}

/** Open book — barista guide. */
export function BookIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10 6C8.6 4.9 6.7 4.5 4 4.5v10.4c2.7 0 4.6.4 6 1.5" />
      <path d="M10 6c1.4-1.1 3.3-1.5 6-1.5v10.4c-2.7 0-4.6.4-6 1.5" />
      <path d="M10 6v10.4" />
    </Icon>
  );
}

/** 2×2 grid. */
export function GridIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" />
      <rect x="11" y="3.5" width="5.5" height="5.5" rx="1" />
      <rect x="3.5" y="11" width="5.5" height="5.5" rx="1" />
      <rect x="11" y="11" width="5.5" height="5.5" rx="1" />
    </Icon>
  );
}

/** Cafe cup — menu. */
export function CupIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4 6.5h9.5V13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M13.5 8h1a2.2 2.2 0 0 1 0 4.4h-1" />
    </Icon>
  );
}

/** Bar chart. */
export function ChartIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3.5 16.5V11" />
      <path d="M8.5 16.5V7" />
      <path d="M13.5 16.5V9" />
      <path d="M2.5 16.5h15" />
    </Icon>
  );
}

/** Stacked box — inventory. */
export function BoxIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10 2.8 3.5 6.3v7.4L10 17.2l6.5-3.5V6.3z" />
      <path d="M3.5 6.3 10 9.8l6.5-3.5" />
      <path d="M10 9.8v7.4" />
    </Icon>
  );
}

/** Horizontal ellipsis — overflow "More". */
export function MoreIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="4.5" cy="10" r="1.4" />
      <circle cx="10" cy="10" r="1.4" />
      <circle cx="15.5" cy="10" r="1.4" />
    </Icon>
  );
}

/** Door with an outbound arrow — log out. */
export function LogoutIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M11.5 3.5h-6A1.5 1.5 0 0 0 4 5v10a1.5 1.5 0 0 0 1.5 1.5h6" />
      <path d="M12.5 10h5.5" />
      <path d="M15.5 7.5 18 10l-2.5 2.5" />
    </Icon>
  );
}
