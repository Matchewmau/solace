import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field } from "./Field";

afterEach(() => cleanup());

describe("Field", () => {
  it("associates the label and hint with the control", () => {
    render(
      <Field label="Amount (₱)" hint="Whole pesos or centavos">
        <input aria-label="Bill amount in pesos" />
      </Field>,
    );
    expect(screen.getByText("Amount (₱)")).toBeDefined();
    expect(screen.getByText("Whole pesos or centavos")).toBeDefined();
    expect(screen.getByLabelText("Bill amount in pesos")).toBeDefined();
  });
});
