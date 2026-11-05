import { expect, test } from "./fixtures";
import { balances } from "./helpers";

// Two JPY records on different days must convert at their own day's market rate. Before the
// fix `getRate` took the newest cached row on or before the date with no lower bound, so the
// first cached JPY→TWD rate was reused for every later date.
const DAY_A = "2019-03-01";
const DAY_B = "2019-03-20"; // 19 days later: beyond the 7-day cache tolerance
const RATE_A = 0.2;
const RATE_B = 0.25;

test.describe("Market rate follows the record's date", () => {
  test("two foreign-currency records convert at their own day's rate", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const days = [DAY_A, DAY_B];
    const clear = () =>
      dbPool.query(
        "DELETE FROM exchange_rates WHERE base = 'JPY' AND quote = 'TWD' AND as_of_date = ANY($1::date[])",
        [days],
      );
    await clear();
    await dbPool.query(
      "INSERT INTO exchange_rates (base, quote, rate, as_of_date) VALUES ('JPY','TWD',$1,$2), ('JPY','TWD',$3,$4)",
      [RATE_A, DAY_A, RATE_B, DAY_B],
    );

    try {
      const { request } = authedPage;
      const before = await balances(request, seeded.groupId);
      for (const day of days) {
        const res = await request.post(`/api/groups/${seeded.groupId}/expenses`, {
          data: {
            amount: 10000,
            currency: "JPY",
            description: `E2E fx ${day} ${Date.now()}`,
            spentAt: `${day}T12:00:00.000Z`,
            shareType: "exact",
            payers: [{ payerId: seeded.userId, amount: 10000 }],
            splits: [{ debtorId: seeded.partnerId, amount: 10000 }],
          },
        });
        expect(res.status(), await res.text()).toBe(201);
      }

      const after = await balances(request, seeded.groupId);
      // 10,000 × 0.20 + 10,000 × 0.25 = 4,500. One shared rate would give 4,000 or 5,000.
      const gained = (after.get(seeded.userId) ?? 0) - (before.get(seeded.userId) ?? 0);
      expect(gained).toBeCloseTo(4500, 1);
    } finally {
      await clear();
    }
  });

  test("the rate hint names the day the market rate is from", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    await dbPool.query(
      "DELETE FROM exchange_rates WHERE base = 'JPY' AND quote = 'TWD' AND as_of_date = $1",
      [DAY_A],
    );
    await dbPool.query(
      "INSERT INTO exchange_rates (base, quote, rate, as_of_date) VALUES ('JPY','TWD',$1,$2)",
      [RATE_A, DAY_A],
    );
    try {
      // 2019-03-03 is a Sunday three days after the cached row.
      const res = await authedPage.request.get(
        `/api/groups/${seeded.groupId}/rates/effective?base=JPY&date=2019-03-03`,
      );
      expect(res.ok()).toBe(true);
      const body = (await res.json()) as { marketRate: number; marketRateDate: string };
      expect(body.marketRate).toBeCloseTo(RATE_A, 6);
      expect(body.marketRateDate).toBe(DAY_A);
    } finally {
      await dbPool.query(
        "DELETE FROM exchange_rates WHERE base = 'JPY' AND quote = 'TWD' AND as_of_date = $1",
        [DAY_A],
      );
    }
  });
});
