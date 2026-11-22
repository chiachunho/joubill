import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SegmentedControl } from "@/components/mini/SegmentedControl";

afterEach(cleanup);

function Harness() {
  const [value, setValue] = useState<"a" | "b" | "c">("b");
  return (
    <SegmentedControl
      label="選擇"
      value={value}
      options={[
        { value: "a", label: "甲" },
        { value: "b", label: "乙" },
        { value: "c", label: "丙" },
      ]}
      onChange={setValue}
    />
  );
}

describe("SegmentedControl", () => {
  it("is one Tab stop: only the checked segment is focusable", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "乙" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "甲" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "丙" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus and the choice with the arrow keys, wrapping at the ends", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "乙" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "丙" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "丙" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("radio", { name: "丙" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "甲" })).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(screen.getByRole("radio", { name: "甲" }), { key: "End" });
    expect(screen.getByRole("radio", { name: "丙" })).toHaveAttribute("aria-checked", "true");
  });

  it("picks a segment on click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "甲" }));
    expect(screen.getByRole("radio", { name: "甲" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "乙" })).toHaveAttribute("aria-checked", "false");
  });
});
