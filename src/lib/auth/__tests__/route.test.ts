import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/auth/errors";
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

  it("lets other errors through", async () => {
    await expect(
      withAuth(async () => {
        throw new Error("boom");
      })(req),
    ).rejects.toThrow("boom");
  });
});
