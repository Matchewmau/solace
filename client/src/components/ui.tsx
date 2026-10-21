import type { MouseEventHandler, ReactNode } from "react";

/**
 * Core UI primitives shared by every later UI task.
 *
 * Deliberately motion/three-free: these land in the eager/POS chunk, so
 * all animation lives in the pure-CSS utilities (`.press`) rather than a
 * JS animation library. Prop shapes are consumed verbatim by later tasks.
 */

export type Tone = "default" | "ok" | "danger";

const TONE_TEXT: Record<Tone, string> = {
  default: "text-ink",
  ok: "text-ok",
  danger: "text-danger",
};

/**
 * One consistent content frame for every standard page: the same max
 * width, page padding, and section rhythm on every route (enforced by
 * page-frame-guard.test.ts). Login (centered login card) and POS
 * (full-bleed register) are the only deliberate exceptions.
 */
export function PageFrame({ children }: { children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:gap-10 sm:px-6 sm:py-12">
      {children}
    </div>
  );
}

/** Rounded bordered paper container with an optional `title` + `action` header. */
export function Box({
  title,
  action,
  className = "",
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={typeof title === "string" ? title : undefined}
      className={`rounded-box border border-ink/10 bg-white p-4 shadow-soft ${className}`.trim()}
    >
      {title ? (
        <header className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Small labelled stat; `tone` colors the value text. */
export function StatChip({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-box border border-ink/10 bg-white px-3 py-2">
      <p className="label text-xs text-muted">{label}</p>
      <p className={`text-lg font-semibold ${TONE_TEXT[tone]}`}>{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export type BadgeTone = "neutral" | "danger" | "ok";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "text-muted",
  danger: "text-danger",
  ok: "text-ok",
};

/** Compact inline status pill; the border follows the tone text color. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-current px-2 py-0.5 text-xs font-semibold ${BADGE_TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export type ButtonVariant = "primary" | "outline" | "danger" | "ghost";
export type ButtonSize = "md" | "lg";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/90",
  outline: "border border-ink/20 hover:border-ink/45 hover:bg-ink/[0.04]",
  danger: "border border-danger text-danger hover:bg-danger/5",
  ghost: "text-muted underline hover:text-ink",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 py-2 text-sm font-semibold",
  lg: "min-h-11 px-4 py-3 text-base font-semibold",
};

/** Shared button. `loading` disables the control and sets `aria-busy`. */
export function Button({
  children,
  variant = "outline",
  size = "md",
  type = "button",
  disabled,
  loading,
  onClick,
  className = "",
  ariaLabel,
  ariaPressed,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  loading?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? "true" : undefined}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      onClick={onClick}
      className={`press inline-flex items-center justify-center gap-2 rounded-box disabled:opacity-50 ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

/** Centered "nothing to show" panel with an optional action node. */
export function EmptyState({
  message,
  children,
}: {
  message: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-box border border-dashed border-ink/15 bg-white/60 px-4 py-8 text-center">
      <p className="text-sm text-muted">{message}</p>
      {children}
    </div>
  );
}
