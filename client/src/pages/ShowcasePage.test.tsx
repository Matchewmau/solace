import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ShowcasePage, { isWebGLAvailable } from "./ShowcasePage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockWebGL(present: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    present ? ({} as WebGLRenderingContext) : null,
  );
}

function StubScene() {
  return <p>Stub 3D scene</p>;
}

describe("isWebGLAvailable", () => {
  it("is false when canvas contexts are absent", () => {
    mockWebGL(false);
    expect(isWebGLAvailable()).toBe(false);
  });

  it("is true when a canvas context exists", () => {
    mockWebGL(true);
    expect(isWebGLAvailable()).toBe(true);
  });
});

describe("ShowcasePage", () => {
  it("always renders the static brand hero", () => {
    mockWebGL(false);
    const loader = vi.fn(async () => ({ default: StubScene }));
    render(<ShowcasePage sceneLoader={loader} />);
    expect(screen.getByRole("heading", { name: "Showcase" })).toBeDefined();
    expect(screen.getByText(/slow-turning mark/)).toBeDefined();
  });

  it("WebGL-absent: keeps static hero + fallback and never calls the scene loader", () => {
    mockWebGL(false);
    const loader = vi.fn(async () => ({ default: StubScene }));
    render(<ShowcasePage sceneLoader={loader} />);
    expect(screen.getByLabelText("3D showcase fallback")).toBeDefined();
    expect(loader).not.toHaveBeenCalled();
  });

  it("renders the lazy scene when WebGL is present and the import resolves", async () => {
    mockWebGL(true);
    const loader = async () => ({ default: StubScene });
    render(<ShowcasePage sceneLoader={loader} />);
    expect(await screen.findByText("Stub 3D scene")).toBeDefined();
    // Static hero stays alongside the scene.
    expect(screen.getByRole("heading", { name: "Showcase" })).toBeDefined();
  });

  it("renders the brand fallback when the lazy import rejects", async () => {
    mockWebGL(true);
    const loader = async (): Promise<{ default: typeof StubScene }> => {
      throw new Error("chunk failed");
    };
    render(<ShowcasePage sceneLoader={loader} />);
    // Error boundary settles on the meaningful brand fallback.
    expect(await screen.findByLabelText("3D showcase fallback")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Showcase" })).toBeDefined();
  });
});
