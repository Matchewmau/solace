import {
  Component,
  Suspense,
  lazy,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";
import { Reveal } from "../components/motion";
import { PageFrame } from "../components/ui";

/**
 * /showcase — isolated 3D showcase. Static brand hero always renders
 * (meaningful content with JS disabled or WebGL absent); the three.js
 * scene loads lazily in its own chunk and never touches the POS chain.
 */

type SceneModule = { default: ComponentType };

function defaultSceneLoader(): Promise<SceneModule> {
  return import("../three/ShowcaseScene");
}

/** WebGL presence probe — canvas context or nothing. */
export function isWebGLAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return gl !== null && gl !== undefined;
  } catch {
    return false;
  }
}

/** Static brand hero — real content, shown on every path. */
export function ShowcaseHero() {
  return (
    <div className="flex flex-col gap-3">
      <p className="label text-xs text-muted">Solace &middot; Showcase</p>
      <h1 className="page-title">Showcase</h1>
      <p className="text-sm text-muted">
        Warm espresso, quiet room — a slow-turning mark in brand ink and
        accent.
      </p>
    </div>
  );
}

/** Meaningful static fallback — brand content, never a spinner. */
export function ShowcaseFallback() {
  return (
    <div
      aria-label="3D showcase fallback"
      className="flex flex-col gap-4 border border-ink/20 p-8"
    >
      <div
        aria-hidden="true"
        className="flex h-40 items-center justify-center bg-ink text-paper"
      >
        <span className="text-5xl font-semibold">S</span>
      </div>
      <p className="text-base">
        Solace in still form — the turning mark needs WebGL, but the coffee
        doesn&apos;t.
      </p>
    </div>
  );
}

export class ShowcaseErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <ShowcaseFallback />;
    return this.props.children;
  }
}

export default function ShowcasePage({
  sceneLoader = defaultSceneLoader,
}: {
  /** Injectable for tests (e.g. a rejecting loader). */
  sceneLoader?: () => Promise<SceneModule>;
}) {
  const webgl = isWebGLAvailable();
  const Scene = useMemo(() => lazy(sceneLoader), [sceneLoader]);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <PageFrame>
        <Reveal className="flex flex-col gap-3">
          <ShowcaseHero />
        </Reveal>
        {webgl ? (
          <ShowcaseErrorBoundary>
            <Suspense fallback={<ShowcaseFallback />}>
              <Scene />
            </Suspense>
          </ShowcaseErrorBoundary>
        ) : (
          <ShowcaseFallback />
        )}
      </PageFrame>
    </main>
  );
}
