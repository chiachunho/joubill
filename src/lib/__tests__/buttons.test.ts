import { describe, expect, it } from "vitest";

import { BTN, button, choice } from "@/lib/buttons";

describe("button", () => {
  it("colours what deletes or detaches red, and the way into the app blue", () => {
    expect(button("delete")).toEqual({ text: BTN.delete, style: "danger" });
    expect(button("confirmUnlink").style).toBe("danger");
    expect(button("approveDeleteGroup").style).toBe("danger");
    expect(button("openApp").style).toBe("primary");
    expect(button("addToGroup").style).toBe("primary");
  });

  it("leaves everything else in the client's own style", () => {
    expect(button("adjust")).toEqual({ text: BTN.adjust });
    expect(button("rejectDeleteGroup")).toEqual({ text: BTN.rejectDeleteGroup });
  });

  it("never uses green: on 同意刪除 it would make a destructive action look safe", () => {
    for (const key of Object.keys(BTN) as (keyof typeof BTN)[]) {
      expect(button(key).style).not.toBe("success");
    }
  });
});

describe("choice", () => {
  it("marks a multi-select ☑ in blue and leaves the rest □", () => {
    expect(choice("小明", true, "multi")).toEqual({ text: "☑︎ 小明", style: "primary" });
    expect(choice("阿華", false, "multi")).toEqual({ text: "□ 阿華" });
  });

  it("marks a single-select ✓ in blue and leaves the rest bare", () => {
    expect(choice("TWD", true, "single")).toEqual({ text: "✓ TWD", style: "primary" });
    expect(choice("JPY", false, "single")).toEqual({ text: "JPY" });
  });
});
