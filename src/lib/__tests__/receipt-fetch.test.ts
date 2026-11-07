import { describe, expect, it } from "vitest";

import { isPublicAddress, parseReceiptUrl, ReceiptFetchError } from "@/lib/receipt-fetch";

describe("isPublicAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "64:ff9b::7f00:1",
    "not-an-ip",
  ])("refuses %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
});

describe("parseReceiptUrl", () => {
  it("accepts a plain https url", () => {
    expect(parseReceiptUrl("https://example.com/r.jpg").hostname).toBe("example.com");
  });

  it.each([
    "http://example.com/r.jpg",
    "ftp://example.com/r.jpg",
    "https://user:pw@example.com/r.jpg",
    "https://example.com:8443/r.jpg",
    "https://127.0.0.1/r.jpg",
    "https://[::1]/r.jpg",
    "https://169.254.169.254/latest/meta-data",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => parseReceiptUrl(url)).toThrow(ReceiptFetchError);
  });
});
