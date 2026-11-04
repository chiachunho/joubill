import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DisplayNameDialog } from "@/components/mini/DisplayNameDialog";
import { MemberNameDialog } from "@/components/mini/MemberNameDialog";
import { fakeRequest, StoreWrapper } from "@/store/test-utils";

afterEach(cleanup);

// Both dialogs start from the saved name each time they open, so a half-typed edit that was
// cancelled doesn't come back the next time.
describe("name dialogs reset when reopened", () => {
  it("DisplayNameDialog goes back to the saved name", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>reopen</button>
          <DisplayNameDialog
            open={open}
            onOpenChange={setOpen}
            current="小明"
            providerName="Ming"
          />
        </>
      );
    }
    render(
      <StoreWrapper request={fakeRequest({})}>
        <Harness />
      </StoreWrapper>,
    );

    const input = () => screen.getByRole("textbox", { name: "顯示名稱" });
    expect(input()).toHaveValue("小明");
    fireEvent.change(input(), { target: { value: "別人" } });
    expect(input()).toHaveValue("別人");

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "顯示名稱" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));

    expect(input()).toHaveValue("小明");
  });

  it("MemberNameDialog goes back to the initial name", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>reopen</button>
          <MemberNameDialog
            open={open}
            onOpenChange={setOpen}
            title="改名"
            initialName="阿華"
            confirmLabel="儲存"
            onSubmit={async () => null}
          />
        </>
      );
    }
    render(<Harness />);

    const input = () => screen.getByRole("textbox");
    expect(input()).toHaveValue("阿華");
    fireEvent.change(input(), { target: { value: "別人" } });

    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));

    expect(input()).toHaveValue("阿華");
  });
});
