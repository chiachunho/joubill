import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("keeps text-2xs beside a text colour (it is a size, not a colour)", () => {
    expect(cn("text-2xs", "text-primary")).toBe("text-2xs text-primary");
  });

  it("lets a later size replace text-2xs", () => {
    expect(cn("text-2xs", "text-sm")).toBe("text-sm");
  });
});
