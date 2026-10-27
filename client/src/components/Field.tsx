import type { ReactNode } from "react";

/**
 * Labelled form row. The control lives inside the `<label>`, so native
 * association works for inputs, selects, and textareas alike.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}
