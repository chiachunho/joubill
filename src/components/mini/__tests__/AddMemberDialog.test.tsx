import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AddMemberDialog } from "@/components/mini/AddMemberDialog";
import { Failure, fakeRequest, StoreWrapper } from "@/store/test-utils";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      <AddMemberDialog
        groupId="9"
        open={open}
        onOpenChange={setOpen}
        inviteHint={() => "the hint"}
      />
    </>
  );
}

function renderDialog(routes: Parameters<typeof fakeRequest>[0] = {}) {
  const request = fakeRequest({
    "/api/groups/9/invite": { code: "K7M2QX9PAB", miniLink: null },
    ...routes,
  });
  render(
    <StoreWrapper request={request}>
      <Harness />
    </StoreWrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: "open" }));
  return request;
}

const NO_ACCOUNT = /新增沒有帳號的成員/;
const BY_INVITE = /用邀請碼邀請/;

describe("AddMemberDialog", () => {
  it("asks first how to add someone, and reads no invite until asked", async () => {
    const request = renderDialog();

    expect(await screen.findByRole("button", { name: NO_ACCOUNT })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BY_INVITE })).toBeInTheDocument();
    expect(screen.queryByLabelText("名字")).not.toBeInTheDocument();
    expect(request.mock.calls.some(([path]) => path === "/api/groups/9/invite")).toBe(false);
  });

  it("a member without an account goes to the name dialog and is added", async () => {
    let body: unknown = null;
    renderDialog({
      "/api/groups/9/members/placeholder": (init) => {
        body = JSON.parse(init!.body as string);
        return { id: 5 };
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: NO_ACCOUNT }));
    fireEvent.change(await screen.findByLabelText("名字"), { target: { value: "小明" } });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));

    await waitFor(() => expect(body).toEqual({ firstName: "小明" }));
    await waitFor(() => expect(screen.queryByLabelText("名字")).not.toBeInTheDocument());
  });

  it("keeps the name dialog open with the server's error when the name is taken", async () => {
    renderDialog({
      "/api/groups/9/members/placeholder": new Failure(409, { error: "名字已被群組成員使用" }),
    });

    fireEvent.click(await screen.findByRole("button", { name: NO_ACCOUNT }));
    fireEvent.change(await screen.findByLabelText("名字"), { target: { value: "小明" } });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));

    expect(await screen.findByText("名字已被群組成員使用")).toBeInTheDocument();
    expect(screen.getByLabelText("名字")).toBeInTheDocument();
  });

  it("an invite shows the code with the platform's hint, and 返回 goes back to the choice", async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: BY_INVITE }));
    expect(await screen.findByText("K7M2Q-X9PAB")).toBeInTheDocument();
    expect(screen.getByText("the hint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重設邀請碼" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByRole("button", { name: BY_INVITE })).toBeInTheDocument();
    expect(screen.queryByText("K7M2Q-X9PAB")).not.toBeInTheDocument();
  });

  it("starts at the choice again after being closed on the invite step", async () => {
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: BY_INVITE }));
    await screen.findByText("K7M2Q-X9PAB");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("K7M2Q-X9PAB")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(await screen.findByRole("button", { name: NO_ACCOUNT })).toBeInTheDocument();
  });
});
