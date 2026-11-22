import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

afterEach(cleanup);

describe("Button loading", () => {
  it("is disabled and busy while loading, and keeps its label as its name", () => {
    render(<Button loading>儲存</Button>);
    const button = screen.getByRole("button", { name: "儲存" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("is an ordinary button otherwise", () => {
    render(<Button>儲存</Button>);
    expect(screen.getByRole("button", { name: "儲存" })).toBeEnabled();
  });
});
