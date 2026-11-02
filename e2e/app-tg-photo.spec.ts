import { expect, test } from "./fixtures";

// The /api/tg-photo proxy is loaded by <img>, which can't send an auth header, so every link
// is signed by the route that minted it. Without a valid signature it must refuse before any
// request to Telegram, whatever file id or path is named.
test.describe("Telegram photo proxy", () => {
  test("refuses a bare file id", async ({ request }) => {
    const res = await request.get("/api/tg-photo?fileId=AgACAgUAAxkBAAIB");
    expect(res.status()).toBe(403);
  });

  test("refuses a bare path and a wrong signature", async ({ request }) => {
    expect((await request.get("/api/tg-photo?path=photos/file_1.jpg")).status()).toBe(403);
    expect((await request.get("/api/tg-photo?path=photos/file_1.jpg&sig=nope")).status()).toBe(403);
  });

  test("rejects path traversal and malformed ids before checking the signature", async ({
    request,
  }) => {
    expect((await request.get("/api/tg-photo?path=../getMe")).status()).toBe(400);
    expect((await request.get("/api/tg-photo?path=photos//../x")).status()).toBe(400);
    expect((await request.get("/api/tg-photo?fileId=a%20b")).status()).toBe(400);
    expect((await request.get("/api/tg-photo")).status()).toBe(400);
  });
});
