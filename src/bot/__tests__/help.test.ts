import { describe, expect, it } from "vitest";

import { BTN } from "@/lib/buttons";
import { HELP_URL } from "@/lib/help-url";

import { helpCommand } from "../commands/help";
import { testBot } from "./harness";

describe("/help", () => {
  it("names the panel buttons by their current labels", async () => {
    const t = testBot(helpCommand);
    await t.send("/help");

    const [text] = t.replies();
    expect(text).toContain("/add 500 晚餐");
    // Prose that names a button interpolates BTN, so a rename can't leave /help stale.
    for (const label of [BTN.adjust, BTN.payer, BTN.who, BTN.shares, BTN.currency, BTN.amount]) {
      expect(text).toContain(label);
    }
  });

  it("links to the help site", async () => {
    const t = testBot(helpCommand);
    await t.send("/help");

    const [sent] = t.callsOf("sendMessage");
    expect(sent.reply_markup).toEqual({
      inline_keyboard: [[{ text: BTN.helpFull, url: HELP_URL }]],
    });
  });

  it("answers the command addressed to this bot", async () => {
    const t = testBot(helpCommand);
    await t.send("/help@splitbill_test_bot");
    expect(t.replies()).toHaveLength(1);
  });

  it("ignores the command addressed to another bot", async () => {
    const t = testBot(helpCommand);
    await t.send("/help@some_other_bot");
    expect(t.replies()).toHaveLength(0);
  });
});
