import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Landing } from "@/components/landing/Landing";
import { REPO_FORK_URL, REPO_URL } from "@/lib/github-repo";

afterEach(cleanup);

const ADD = "https://t.me/splitbill_bot?startgroup=true";

describe("Landing", () => {
  it("sends both add-to-group buttons to Telegram's group picker in a new tab", () => {
    render(<Landing addToGroupHref={ADD} stars={null} />);
    const links = screen.getAllByRole("link", { name: "加到 Telegram 群組" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", ADD);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("keeps the help-site fallback in the same tab", () => {
    render(<Landing addToGroupHref="/help" stars={null} />);
    for (const link of screen.getAllByRole("link", { name: "加到 Telegram 群組" })) {
      expect(link).toHaveAttribute("href", "/help");
      expect(link).not.toHaveAttribute("target");
    }
  });

  it("links Star and Fork to the repository and shows the star count when known", () => {
    render(<Landing addToGroupHref={ADD} stars={1234} />);
    const stars = screen.getAllByRole("link", { name: "在 GitHub 上給 Star，目前 1234 顆" });
    expect(stars.length).toBeGreaterThan(0);
    for (const s of stars) {
      expect(s).toHaveAttribute("href", REPO_URL);
      expect(s).toHaveTextContent("1.2k");
    }
    expect(screen.getByRole("link", { name: "Fork" })).toHaveAttribute("href", REPO_FORK_URL);
  });

  it("shows the Star button without a number when GitHub couldn't be asked", () => {
    render(<Landing addToGroupHref={ADD} stars={null} />);
    expect(screen.getAllByRole("link", { name: "在 GitHub 上給 Star" }).length).toBeGreaterThan(0);
  });

  it("links the legal pages from the footer", () => {
    render(<Landing addToGroupHref={ADD} stars={null} />);
    expect(screen.getByRole("link", { name: "隱私權政策" })).toHaveAttribute(
      "href",
      "/help/privacy",
    );
    expect(screen.getByRole("link", { name: "服務條款" })).toHaveAttribute("href", "/help/terms");
  });
});
