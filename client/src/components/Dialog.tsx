import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * Overlay primitives for the eager/POS chain.
 *
 * Both Dialog and BottomSheet deliberately avoid a JS animation library:
 * motion lives in the pure-CSS utilities (`.sheet-up`), keeping this file
 * on the eager/POS chain. The shared focus contract — trap Tab and restore
 * the opener's focus — lives here in {@link useDialogFocus} and is reused
 * verbatim by BottomSheet.
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * On open: focus the panel and remember the previously focused element.
 * While open: Escape calls `onClose`, and Tab / Shift-Tab cycle within the
 * panel's focusable elements. On close / unmount: restore the opener's focus.
 *
 * Returns the ref to attach to the panel (which must be `tabIndex={-1}`).
 */
export function useDialogFocus(
  open: boolean,
  onClose: () => void,
): RefObject<HTMLDivElement | null> {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    restoreRef.current = previouslyFocused;
    panelRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (panel === null) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return panelRef;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  const panelRef = useDialogFocus(open, onClose);
  if (!open) return null;

  return (
    <div
      data-testid="dialog-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`w-full max-w-lg rounded-box bg-paper p-6 text-ink shadow-sheet ${className}`.trim()}
      >
        {children}
      </div>
    </div>
  );
}
