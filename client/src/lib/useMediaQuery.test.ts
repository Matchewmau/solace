import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "./useMediaQuery";

/**
 * `MediaQueryList` stub whose change listeners the test can drive directly, so
 * the subscription contract is exercised without a real browser.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "",
    onchange: null,
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.add(listener);
    },
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  const matchMedia = vi.fn(() => mql);
  vi.stubGlobal("matchMedia", matchMedia);

  /** Flip `matches` and notify every subscriber, like the browser would. */
  function emit(next: boolean) {
    (mql as { matches: boolean }).matches = next;
    for (const listener of listeners) {
      listener({ matches: next } as MediaQueryListEvent);
    }
  }

  return { mql, matchMedia, listeners, emit };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("returns the fallback when matchMedia is unavailable", () => {
    // jsdom has no window.matchMedia; a bare call must be false-safe.
    vi.stubGlobal("matchMedia", undefined);

    expect(
      renderHook(() => useMediaQuery("(min-width: 1024px)")).result.current,
    ).toBe(true);
    expect(
      renderHook(() => useMediaQuery("(min-width: 1024px)", false)).result
        .current,
    ).toBe(false);
  });

  it("reflects a matching query and reacts to change events", () => {
    const { emit } = stubMatchMedia(true);

    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(true);

    act(() => emit(false));
    expect(result.current).toBe(false);

    act(() => emit(true));
    expect(result.current).toBe(true);
  });

  it("subscribes on mount and unsubscribes on unmount", () => {
    const { listeners, matchMedia } = stubMatchMedia(false);

    const { unmount } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(listeners.size).toBe(1);

    unmount();
    expect(listeners.size).toBe(0);
  });
});
