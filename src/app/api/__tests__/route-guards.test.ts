import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Invariants every API route handler must keep, checked across the whole route tree rather
 * than one route at a time, so a route added later is covered without anyone remembering
 * to write a test for it.
 *
 * - Every route module declares the Node runtime and `force-dynamic` (CLAUDE.md: the Neon
 *   driver needs both).
 * - A group-scoped handler (`/api/groups/[id]/**`) refuses a caller who isn't signed in
 *   (401) or isn't a member (403) **before it reads anything else**: the database is
 *   replaced by an object that throws on any access, so a handler that queries first and
 *   checks membership second fails here instead of quietly leaking another group's data.
 */

const auth = vi.hoisted(() => ({
  mode: "forbidden" as "forbidden" | "unauthorized",
  /** Set by any database access, so a handler that swallows the throw is still caught. */
  dbTouched: false,
}));

vi.mock("@/db", () => {
  const touched = () => {
    auth.dbTouched = true;
    throw new Error("the handler read the database before checking membership");
  };
  return { db: new Proxy({}, { get: touched }) };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  const { ForbiddenError, UnauthorizedError } = await import("@/lib/auth/errors");
  return {
    ...real,
    getAuth: vi.fn(async () => {
      if (auth.mode === "unauthorized") throw new UnauthorizedError();
      return { user: { id: 1, telegramId: 1000, firstName: "Viewer" } };
    }),
    assertGroupMember: vi.fn(async () => {
      throw new ForbiddenError("not a member of this group");
    }),
    findUsersNotInGroup: vi.fn(async () => {
      auth.dbTouched = true;
      throw new Error("the handler read the database before checking membership");
    }),
  };
});

const API_DIR = path.resolve(__dirname, "..");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const ALL_ROUTES = routeFiles(API_DIR);
const GROUP_ROUTES = ALL_ROUTES.filter((f) =>
  f.startsWith(path.join(API_DIR, "groups", "[id]") + path.sep),
);

/** A plausible value for each dynamic segment, so id parsing passes and the guard is reached. */
const SEGMENT_VALUES: Record<string, string> = {
  id: "7",
  expenseId: "11",
  settlementId: "12",
  userId: "2",
};

function routeUrlAndParams(file: string) {
  const rel = path.relative(API_DIR, path.dirname(file)).split(path.sep);
  const params: Record<string, string> = {};
  const segments = rel.map((seg) => {
    const m = /^\[(\w+)\]$/.exec(seg);
    if (!m) return seg;
    const value = SEGMENT_VALUES[m[1]];
    if (!value) throw new Error(`add a value for [${m[1]}] to SEGMENT_VALUES`);
    params[m[1]] = value;
    return value;
  });
  // Query parameters some handlers need before they get as far as the guard.
  const query = "intoUserId=3&range=all&base=JPY&format=csv";
  return { url: `https://example.com/api/${segments.join("/")}?${query}`, params };
}

function label(file: string) {
  return "/api/" + path.relative(API_DIR, path.dirname(file)).split(path.sep).join("/");
}

describe("every API route module", () => {
  it("finds the routes", () => {
    expect(ALL_ROUTES.length).toBeGreaterThan(20);
    expect(GROUP_ROUTES.length).toBeGreaterThan(10);
  });

  it.each(ALL_ROUTES.map((f) => [label(f), f]))(
    "%s declares the Node runtime and force-dynamic",
    (_, file) => {
      const src = readFileSync(file, "utf8");
      expect(src).toMatch(/export const runtime = "nodejs"/);
      expect(src).toMatch(/export const dynamic = "force-dynamic"/);
    },
  );
});

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

type Method = (typeof METHODS)[number];

// Only the methods each module really exports, so no case passes by testing nothing.
const groupModules = await Promise.all(
  GROUP_ROUTES.map(async (file) => ({
    file,
    mod: (await import(file)) as Partial<Record<Method, Handler>>,
  })),
);
const groupHandlers = groupModules.flatMap(({ file, mod }) =>
  METHODS.filter((m) => typeof mod[m] === "function").map(
    (m) => [`${m} ${label(file)}`, mod[m]!, file] as const,
  ),
);

async function call(handler: Handler, file: string, method: string) {
  const { url, params } = routeUrlAndParams(file);
  const hasBody = method !== "GET" && method !== "DELETE";
  const req = new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: hasBody ? "{}" : undefined,
  });
  return handler(req, { params: Promise.resolve(params) });
}

describe("group-scoped handlers", () => {
  beforeEach(() => {
    auth.mode = "forbidden";
    auth.dbTouched = false;
  });

  it.each(groupModules.map(({ file, mod }) => [label(file), mod] as const))(
    "%s exports at least one handler",
    (_, mod) => {
      expect(METHODS.some((m) => typeof mod[m] === "function")).toBe(true);
    },
  );

  it.each(groupHandlers)(
    "%s refuses a non-member before reading anything",
    async (name, handler, file) => {
      const res = await call(handler, file, name.split(" ")[0]);
      expect(res.status).toBe(403);
      expect(auth.dbTouched).toBe(false);
    },
  );

  it.each(groupHandlers)("%s refuses a caller who isn't signed in", async (name, handler, file) => {
    auth.mode = "unauthorized";
    const res = await call(handler, file, name.split(" ")[0]);
    expect(res.status).toBe(401);
    expect(auth.dbTouched).toBe(false);
  });
});
