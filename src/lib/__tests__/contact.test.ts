import { describe, expect, it } from "vitest";

import { contactEmail } from "@/lib/contact";

describe("contactEmail", () => {
  it("returns the trimmed address", () => {
    expect(contactEmail({ CONTACT_EMAIL: "  hi@example.com " })).toBe("hi@example.com");
  });

  it("is null when unset or blank, so the page never prints an empty mailto", () => {
    expect(contactEmail({})).toBeNull();
    expect(contactEmail({ CONTACT_EMAIL: "   " })).toBeNull();
  });
});
