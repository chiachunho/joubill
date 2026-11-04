import { describe, expect, it } from "vitest";

import { ForbiddenError, TooManyRequestsError } from "@/lib/auth/errors";
import { withAuth } from "@/lib/auth/route";
import { requireId } from "@/lib/route-params";

const req = new Request("http://localhost/api/x");

describe("withAuth", () => {
  it("answers a thrown BadRequestError as its 400", async () => {
    const res = await withAuth(async () => {
      requireId("1.5", "group id");
      return Response.json({});
    })(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid group id" });
  });

  it("still answers an AuthError as its status", async () => {
    const res = await withAuth(async () => {
      throw new ForbiddenError("nope");
    })(req);
    expect(res.status).toBe(403);
  });

  it("answers a TooManyRequestsError with Retry-After and no wait time in the body", async () => {
    const res = await withAuth(async () => {
      throw new TooManyRequestsError("嘗試太多次，請稍後再試", 600);
    })(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(await res.json()).toEqual({ error: "嘗試太多次，請稍後再試" });
  });

  it("lets other errors through", async () => {
    await expect(
      withAuth(async () => {
        throw new Error("boom");
      })(req),
    ).rejects.toThrow("boom");
  });
});
