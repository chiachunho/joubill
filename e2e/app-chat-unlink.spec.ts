import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { expect, test } from "./fixtures";
import { addExpense, auditActions } from "./helpers";

test.describe("Unlinking a group from its Telegram chat", () => {
  test("a member unlinks from group settings and the ledger is untouched", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    // A card the old chat holds for the seeded expense.
    await db
      .update(schema.expenses)
      .set({ noticeMessageId: 4242 })
      .where(eq(schema.expenses.id, seeded.expenseId));
    const membersBefore = await db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, seeded.groupId));

    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await expect(authedPage.getByRole("button", { name: /解除綁定/ })).toBeVisible();

    await authedPage.getByRole("button", { name: /解除綁定/ }).click();
    await expect(authedPage.getByText(/bot 會離開那個 Telegram 群組/)).toBeVisible();
    // Nothing happens until the dialog is confirmed.
    const [stillLinked] = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, seeded.groupId));
    expect(stillLinked.chatId).not.toBeNull();

    await authedPage.getByRole("dialog").getByRole("button", { name: "解除綁定" }).click();
    await expect(authedPage.getByText("尚未綁定")).toBeVisible();

    const [group] = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, seeded.groupId));
    expect(group.chatType).toBeNull();
    expect(group.chatId).toBeNull();

    const [expense] = await db
      .select()
      .from(schema.expenses)
      .where(eq(schema.expenses.id, seeded.expenseId));
    expect(expense.noticeMessageId).toBeNull();
    expect(Number(expense.amount)).toBe(300);

    const membersAfter = await db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, seeded.groupId));
    expect(membersAfter).toHaveLength(membersBefore.length);

    expect(await auditActions(dbPool, seeded.groupId)).toContain("chat_unlinked");
  });

  test("the group page still works and new records send nothing to Telegram", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    const res = await authedPage.request.delete(`/api/groups/${seeded.groupId}/chat`);
    expect(res.status()).toBe(200);

    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage.getByRole("heading", { name: seeded.groupTitle })).toBeVisible();
    await expect(
      authedPage.getByText(seeded.expenseDescription, { exact: true }).first(),
    ).toBeVisible();

    const id = await addExpense(authedPage.request, seeded.groupId, {
      amount: 100,
      shareType: "equal",
      payers: [{ payerId: seeded.userId, amount: 100 }],
      splits: [
        { debtorId: seeded.userId, amount: 50 },
        { debtorId: seeded.partnerId, amount: 50 },
      ],
    });
    const [created] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, id));
    expect(created.noticeMessageId).toBeNull();
  });

  test("a second unlink is refused, and the chat read says the group is unbound", async ({
    authedPage,
    seeded,
  }) => {
    const url = `/api/groups/${seeded.groupId}/chat`;
    expect(((await (await authedPage.request.get(url)).json()) as { linked: boolean }).linked).toBe(
      true,
    );

    expect((await authedPage.request.delete(url)).status()).toBe(200);
    expect((await authedPage.request.delete(url)).status()).toBe(409);
    expect(await (await authedPage.request.get(url)).json()).toEqual({
      linked: false,
      title: null,
    });
  });

  test("the activity feed names the chat that was unlinked", async ({ authedPage, seeded }) => {
    await authedPage.request.delete(`/api/groups/${seeded.groupId}/chat`);

    await authedPage.goto(`/app/groups/${seeded.groupId}/activity`);
    await expect(authedPage.getByText(/解除了與 Telegram 群組/)).toBeVisible();
  });

  test("an outsider can neither read nor unlink the chat", async ({ authedPage, seeded }) => {
    const url = `/api/groups/${seeded.foreignGroupId}/chat`;
    expect((await authedPage.request.get(url)).status()).toBe(403);
    expect((await authedPage.request.delete(url)).status()).toBe(403);
  });
});
