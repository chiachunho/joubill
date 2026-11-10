import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LifeDemo } from "@/components/landing/LifeDemo";
import { BTN } from "@/lib/buttons";

afterEach(cleanup);

const card = () => screen.getByTestId("life-demo-card");

describe("LifeDemo", () => {
  it("starts on the freshly recorded card with its buttons", () => {
    render(<LifeDemo />);
    expect(screen.getByRole("tab", { name: "記下來" })).toHaveAttribute("aria-selected", "true");
    expect(card()).toHaveTextContent("300 TWD");
    expect(card()).toHaveTextContent(BTN.delete);
  });

  it("corrects the same card in place, then leaves a tombstone naming both people", () => {
    render(<LifeDemo />);
    fireEvent.click(screen.getByRole("tab", { name: "發現記錯" }));
    expect(card()).toHaveTextContent("3,000 TWD");
    expect(card()).toHaveTextContent("已編輯");

    fireEvent.click(screen.getByRole("tab", { name: "刪掉" }));
    expect(card()).toHaveTextContent("小明 記錄 · 阿華 刪除");
    // A tombstone has no keyboard: nothing on it can be pressed any more.
    expect(card()).not.toHaveTextContent(BTN.delete);
  });

  it("moves between stages with the arrow keys", () => {
    render(<LifeDemo />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "記下來" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "刪掉" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "刪掉" })).toHaveFocus();
  });
});
