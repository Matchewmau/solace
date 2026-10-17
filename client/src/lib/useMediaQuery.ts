import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query.
 *
 * `window.matchMedia` is missing in jsdom, so when it is unavailable the hook
 * returns `fallback` (true by default) and never subscribes — keeping the
 * default test environment on the desktop layout. In a real browser it seeds
 * from `matches` and follows `change` events.
 */
export function useMediaQuery(query: string, fallback = true): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return fallback;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Re-seed in case the query changed since the initial render.
    setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
