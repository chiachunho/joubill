import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { addDays, todayIn } from "../src/lib/day";
import { expect, test } from "./fixtures";
import { addExpense, auditActions, signedInPage } from "./helpers";

// Issue #144: a record's date is a plain day, and a group has a time zone that decides what
// "today" is. The zone is never allowed to move a record that already has a date.

async function groupZone(
  db: ReturnType<typeof drizzle<typeof schema>>,
  groupId: number,
): Promise<string> {
  const [g] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  return g.timezone;
}

test.describe("Group time zone", () => {
  test("a member changes it in group settings and the change is logged", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    expect(await groupZone(db, seeded.groupId)).toBe("Asia/Taipei");

    await authedPage.goto(`/app/groups/${seeded.groupId}/settings/rates`);
    await expect(authedPage.getByText(/決定一筆紀錄算哪一天/)).toBeVisible();

    await authedPage.getByRole("combobox", { name: "時區" }).click();
    await authedPage.getByRole("option", { name: "Asia/Tokyo (UTC+9)" }).click();
    // Nothing is saved until the dialog is confirmed.
    await expect(authedPage.getByRole("dialog")).toContainText("已經記下的紀錄日期不會改變");
    expect(await groupZone(db, seeded.groupId)).toBe("Asia/Taipei");

    await authedPage.getByRole("dialog").getByRole("button", { name: "變更" }).click();
    await expect.poll(() => groupZone(db, seeded.groupId)).toBe("Asia/Tokyo");

    expect(await auditActions(dbPool, seeded.groupId)).toContain("timezone_changed");
    await authedPage.goto(`/app/groups/${seeded.groupId}/activity`);
    await expect(authedPage.getByText("把群組時區從 Asia/Taipei 改成 Asia/Tokyo")).toBeVisible();
  });

  test("the API refuses an arbitrary string, and a no-op change logs nothing", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const { request } = authedPage;
    const patch = (timezone: string) =>
      request.patch(`/api/groups/${seeded.groupId}/settings`, { data: { timezone } });

    for (const bad of ["Tokyo", "UTC+9", "", "Asia/Nowhere"]) {
      expect((await patch(bad)).status(), bad).toBe(400);
    }
    expect(await auditActions(dbPool, seeded.groupId)).not.toContain("timezone_changed");

    // Already Asia/Taipei: accepted, and there is nothing to log.
    expect((await patch("Asia/Taipei")).status()).toBe(200);
    expect(await auditActions(dbPool, seeded.groupId)).not.toContain("timezone_changed");

    const res = await patch("America/Los_Angeles");
    expect(res.status()).toBe(200);
    expect((await res.json()).timezone).toBe("America/Los_Angeles");
    expect(
      (await auditActions(dbPool, seeded.groupId)).filter((a) => a === "timezone_changed"),
    ).toHaveLength(1);
  });

  test("changing it moves no record's date", async ({ authedPage, seeded, dbPool }) => {
    const { request } = authedPage;
    const id = await addExpense(request, seeded.groupId, {
      amount: 100,
      shareType: "equal",
      payers: [{ payerId: seeded.userId, amount: 100 }],
      splits: [
        { debtorId: seeded.userId, amount: 50 },
        { debtorId: seeded.partnerId, amount: 50 },
      ],
      spentAt: "2026-03-01",
    });
    const read = async () =>
      (await dbPool.query("SELECT spent_date::text AS d FROM expenses WHERE id = $1", [id])).rows[0]
        .d;
    expect(await read()).toBe("2026-03-01");

    for (const timezone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Taipei"]) {
      const res = await request.patch(`/api/groups/${seeded.groupId}/settings`, {
        data: { timezone },
      });
      expect(res.status()).toBe(200);
      expect(await read()).toBe("2026-03-01");
    }
  });

  test("a device in another zone is asked once, and 不用 is remembered", async ({
    browser,
    baseURL,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.userId, {
      timezoneId: "Asia/Tokyo",
    });
    try {
      await page.goto(`/app/groups/${seeded.groupId}`);
      await expect(page.getByText(/你的裝置時區是/)).toBeVisible();
      await expect(page.getByText(/Asia\/Tokyo \(UTC\+9\)/).first()).toBeVisible();

      await page.getByRole("button", { name: "不用" }).click();
      await expect(page.getByText(/你的裝置時區是/)).toBeHidden();
      await page.reload();
      await expect(page.getByText(seeded.groupTitle, { exact: true })).toBeVisible();
      await expect(page.getByText(/你的裝置時區是/)).toBeHidden();
      expect(await groupZone(db, seeded.groupId)).toBe("Asia/Taipei");
    } finally {
      await context.close();
    }
  });

  test("accepting the prompt switches the group to the device's zone", async ({
    browser,
    baseURL,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.userId, {
      timezoneId: "Asia/Seoul",
    });
    try {
      await page.goto(`/app/groups/${seeded.groupId}`);
      await page.getByRole("button", { name: "改成 Asia/Seoul" }).click();
      await expect.poll(() => groupZone(db, seeded.groupId)).toBe("Asia/Seoul");
      await expect(page.getByText(/你的裝置時區是/)).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("a device at the same UTC offset is not asked", async ({
    browser,
    baseURL,
    seeded,
    dbPool,
  }) => {
    // Singapore and Taipei are both UTC+8.
    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.userId, {
      timezoneId: "Asia/Singapore",
    });
    try {
      await page.goto(`/app/groups/${seeded.groupId}`);
      await expect(page.getByText(seeded.groupTitle, { exact: true })).toBeVisible();
      await expect(page.getByText(/你的裝置時區是/)).toBeHidden();
    } finally {
      await context.close();
    }
  });

  test("a new group starts in the zone chosen on the create form", async ({
    browser,
    baseURL,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    const title = `E2E tz group ${Date.now()}`;
    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.userId, {
      timezoneId: "Asia/Tokyo",
    });
    try {
      await page.goto("/app/groups/new");
      await page.getByPlaceholder("例如：東京旅行").fill(title);
      // Defaults to the device's zone.
      await expect(page.getByRole("combobox", { name: "時區" })).toContainText("Asia/Tokyo");
      await page.getByRole("button", { name: "建立群組" }).click();
      await expect(page).toHaveURL(/\/app\/groups\/\d+$/);

      const [group] = await db.select().from(schema.groups).where(eq(schema.groups.title, title));
      expect(group.timezone).toBe("Asia/Tokyo");
      // Creating it in the zone the device is in is not a change, and the prompt stays quiet.
      expect(await auditActions(dbPool, group.id)).not.toContain("timezone_changed");
      await expect(page.getByText(/你的裝置時區是/)).toBeHidden();
    } finally {
      await db.delete(schema.groups).where(eq(schema.groups.title, title));
      await context.close();
    }
  });
});

test.describe("A record's date is a day", () => {
  test("the API stores and returns YYYY-MM-DD, and refuses an instant", async ({
    authedPage,
    seeded,
  }) => {
    const { request } = authedPage;
    const body = {
      amount: 100,
      currency: "TWD",
      description: `E2E date ${Date.now()}`,
      shareType: "equal",
      payers: [{ payerId: seeded.userId, amount: 100 }],
      splits: [
        { debtorId: seeded.userId, amount: 50 },
        { debtorId: seeded.partnerId, amount: 50 },
      ],
    };

    for (const spentAt of ["2026-03-01T12:00:00.000Z", "2026-02-31", "tomorrow"]) {
      const res = await request.post(`/api/groups/${seeded.groupId}/expenses`, {
        data: { ...body, spentAt },
      });
      expect(res.status(), spentAt).toBe(400);
    }

    const res = await request.post(`/api/groups/${seeded.groupId}/expenses`, {
      data: { ...body, spentAt: "2026-03-01" },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { id } = await res.json();

    const detail = await (await request.get(`/api/groups/${seeded.groupId}/expenses/${id}`)).json();
    expect(detail.spentAt).toBe("2026-03-01");
    const list = await (await request.get(`/api/groups/${seeded.groupId}/expenses`)).json();
    expect(list.expenses.find((e: { id: number }) => e.id === id).spentAt).toBe("2026-03-01");
  });

  test("the list pages through days and ids, and a stale cursor is a 400", async ({
    authedPage,
    seeded,
  }) => {
    const { request } = authedPage;
    const first = await (await request.get(`/api/groups/${seeded.groupId}/expenses`)).json();
    expect(first.nextCursor).toBeNull();
    for (const cursor of ["2026-03-04T05:06:07.123456Z_5", "2026-02-31_5", "x"]) {
      const res = await request.get(
        `/api/groups/${seeded.groupId}/expenses?cursor=${encodeURIComponent(cursor)}`,
      );
      expect(res.status(), cursor).toBe(400);
    }
  });

  test("a custom stats range is inclusive days, and an instant is refused", async ({
    authedPage,
    seeded,
  }) => {
    const { request } = authedPage;
    const today = todayIn("Asia/Taipei");
    const stats = (query: string) =>
      request.get(`/api/groups/${seeded.groupId}/stats?range=custom&${query}`);

    const ok = await stats(`from=${today}&to=${today}`);
    expect(ok.status(), await ok.text()).toBe(200);
    const body = await ok.json();
    expect(body.range).toEqual({ key: "custom", from: today, to: today });
    // The seeded 300 expense is dated today, so a one-day range holds it.
    expect(
      body.monthly.reduce((sum: number, m: { groupTotal: number }) => sum + m.groupTotal, 0),
    ).toBe(300);

    expect((await stats(`from=${today}T00:00:00Z&to=${today}T23:59:59Z`)).status()).toBe(400);
    expect((await stats(`from=${addDays(today, 1)}&to=${today}`)).status()).toBe(400);
  });

  test("a row the previous release writes by spent_at still gets the right day", async ({
    seeded,
    dbPool,
  }) => {
    // The previous release is still serving while this one builds. It writes only the old
    // timestamp column; the trigger fills the day in the group's zone, and the other way round.
    const stamp = `E2E legacy ${Date.now()}`;
    const { rows } = await dbPool.query(
      `INSERT INTO expenses (group_id, type, amount, currency, description, spent_at, created_by)
       VALUES ($1, 'expense', 10, 'TWD', $2, '2026-03-01T17:00:00Z', $3)
       RETURNING id, spent_date::text AS d`,
      [seeded.groupId, stamp, seeded.userId],
    );
    // 17:00 UTC is 01:00 the next morning in Taipei, the day its rate was always looked up for.
    expect(rows[0].d).toBe("2026-03-02");

    const moved = await dbPool.query(
      "UPDATE expenses SET spent_at = '2026-03-10T04:00:00Z' WHERE id = $1 RETURNING spent_date::text AS d",
      [rows[0].id],
    );
    expect(moved.rows[0].d).toBe("2026-03-10");

    // And the new release's write is mirrored into the old column as that day's UTC noon.
    const back = await dbPool.query(
      "UPDATE expenses SET spent_date = '2026-04-05' WHERE id = $1 RETURNING spent_at",
      [rows[0].id],
    );
    expect(new Date(back.rows[0].spent_at).toISOString()).toBe("2026-04-05T12:00:00.000Z");
  });
});
