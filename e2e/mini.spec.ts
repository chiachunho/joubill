import { expect, test } from "./fixtures";
import { initDataFor, miniBotToken, openMini, tmaHeaders } from "./mini";

// The Mini App (`/mini`) against the deployed site, signed in with initData the suite signs
// itself (see `e2e/mini.ts`). The page bodies are shared with `/app`, which has the deeper
// coverage; these cases cover what only the Mini App has: the `tma` auth path, the
// `startapp` deep links, and that the shared pages work under `/mini`.
test.describe("Mini App", () => {
  test.skip(!miniBotToken(), "E2E_TELEGRAM_BOT_TOKEN is not set");

  const me = (s: { telegramId: number; firstName: string }) => ({
    telegramId: s.telegramId,
    firstName: s.firstName,
  });

  test.describe("initData auth", () => {
    test("API accepts signed initData and resolves the seeded user", async ({
      request,
      seeded,
    }) => {
      const res = await request.get("/api/me/groups", {
        headers: tmaHeaders(initDataFor(me(seeded))),
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = (await res.json()) as { userId: number; groups: { id: number }[] };
      expect(body.userId).toBe(seeded.userId);
      expect(body.groups.map((g) => g.id)).toContain(seeded.groupId);
    });

    test("API refuses a tampered hash", async ({ request, seeded }) => {
      const initData = initDataFor(me(seeded)).replace(/hash=[0-9a-f]+/, `hash=${"0".repeat(64)}`);
      const res = await request.get("/api/me/groups", { headers: tmaHeaders(initData) });
      expect(res.status()).toBe(401);
    });

    test("API refuses initData signed with another bot's token", async ({ request, seeded }) => {
      const initData = initDataFor(me(seeded), { botToken: "123456:not-the-real-token" });
      const res = await request.get("/api/me/groups", { headers: tmaHeaders(initData) });
      expect(res.status()).toBe(401);
    });

    test("API refuses initData older than a day", async ({ request, seeded }) => {
      const initData = initDataFor(me(seeded), {
        authDate: Math.floor(Date.now() / 1000) - 25 * 60 * 60,
      });
      const res = await request.get("/api/me/groups", { headers: tmaHeaders(initData) });
      expect(res.status()).toBe(401);
    });

    test("API refuses a group the user is not a member of", async ({ request, seeded }) => {
      const res = await request.get(`/api/groups/${seeded.foreignGroupId}/members`, {
        headers: tmaHeaders(initDataFor(me(seeded))),
      });
      expect(res.status()).toBe(403);
    });
  });

  test.describe("deep links", () => {
    test("a group link opens the group page", async ({ page, seeded }) => {
      await openMini(page, "", me(seeded), { startParam: `group_${seeded.chatId}` });
      await expect(page).toHaveURL(new RegExp(`/mini/groups/${seeded.groupId}$`));
      await expect(page.getByRole("heading", { name: seeded.groupTitle })).toBeVisible();
    });

    test("an expense link opens that expense's edit page", async ({ page, seeded }) => {
      await openMini(page, "", me(seeded), {
        startParam: `group_${seeded.chatId}_exp_${seeded.expenseId}`,
      });
      await expect(page).toHaveURL(
        new RegExp(`/mini/groups/${seeded.groupId}/expenses/${seeded.expenseId}/edit$`),
      );
      await expect(page.getByPlaceholder("例如：晚餐、機票")).toHaveValue(
        seeded.expenseDescription,
      );
    });

    test("a group link does not seat someone who is not in the chat", async ({
      request,
      seeded,
    }) => {
      // The seeded chat id doesn't exist on Telegram, so getChatMember can't confirm the
      // outsider and the auto-join must not happen.
      const outsider = {
        telegramId: seeded.outsiderTelegramId,
        firstName: seeded.outsiderFirstName,
      };
      const initData = initDataFor(outsider, { startParam: `group_${seeded.chatId}` });

      const groupsRes = await request.get("/api/me/groups", { headers: tmaHeaders(initData) });
      expect(groupsRes.status()).toBe(200);
      const body = (await groupsRes.json()) as { groups: { id: number }[] };
      expect(body.groups.map((g) => g.id)).not.toContain(seeded.groupId);

      const membersRes = await request.get(`/api/groups/${seeded.groupId}/members`, {
        headers: tmaHeaders(initData),
      });
      expect(membersRes.status()).toBe(403);
    });
  });

  test.describe("pages", () => {
    test("group list shows the seeded group", async ({ page, seeded }) => {
      await openMini(page, "", me(seeded));
      await expect(page.getByText(seeded.groupTitle, { exact: true }).first()).toBeVisible();
    });

    test("group page lists the seeded expense", async ({ page, seeded }) => {
      await openMini(page, `/groups/${seeded.groupId}`, me(seeded));
      await expect(page.getByRole("heading", { name: seeded.groupTitle })).toBeVisible();
      await expect(
        page.getByText(seeded.expenseDescription, { exact: true }).first(),
      ).toBeVisible();
    });

    test("creates an expense through the form and returns to the group page", async ({
      page,
      seeded,
    }) => {
      const description = `E2E mini lunch ${Date.now()}`;
      await openMini(page, `/groups/${seeded.groupId}/expenses/new`, me(seeded));
      await page.getByLabel("金額", { exact: true }).fill("150");
      await page.getByLabel("說明", { exact: true }).fill(description);
      await page.getByRole("button", { name: "儲存", exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`/mini/groups/${seeded.groupId}$`));
      await expect(page.getByText(description, { exact: true }).first()).toBeVisible();
    });
  });
});
