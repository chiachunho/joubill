import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar } from "@/components/mini/Avatar";

afterEach(cleanup);

describe("Avatar", () => {
  it("shows the initials when the picture fails to load, instead of nothing", () => {
    render(<Avatar src="/api/tg-photo?fileId=gone" name="Test New" userId={3} />);
    fireEvent.error(screen.getByRole("img", { name: "Test New" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("TN")).toBeInTheDocument();
  });

  it("shows the caller's fallback when there is no picture", () => {
    render(<Avatar name="小明" userId={0} fallback={<span>預設頭像</span>} />);
    expect(screen.getByText("預設頭像")).toBeInTheDocument();
  });
});
