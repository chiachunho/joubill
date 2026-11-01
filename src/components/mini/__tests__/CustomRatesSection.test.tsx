import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CustomRatesSection } from "@/components/mini/CustomRatesSection";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

afterEach(cleanup);

describe("CustomRatesSection", () => {
  it("shows no text while the rates load, then the empty state", async () => {
    let answer: (value: Response) => void = () => {};
    const request = fakeRequest({});
    request.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    render(
      <StoreWrapper request={request}>
        <CustomRatesSection groupId="9" defaultCurrency="TWD" />
      </StoreWrapper>,
    );

    expect(screen.queryByText("載入中…")).not.toBeInTheDocument();
    expect(screen.queryByText("未設定，使用市場匯率換算")).not.toBeInTheDocument();

    answer(new Response(JSON.stringify({ rates: [] }), { status: 200 }));
    expect(await screen.findByText("未設定，使用市場匯率換算")).toBeInTheDocument();
  });
});
