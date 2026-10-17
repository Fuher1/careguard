import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TxLink } from "../components/primitives/tx-link";

describe("TxLink transaction hash display", () => {
  it("uses the shared display length while retaining the full hash in the link", () => {
    const hash = "a".repeat(64);
    render(<TxLink hash={hash} />);

    const link = screen.getByRole("link");
    expect(link.textContent).toBe(`${"a".repeat(16)}...`);
    expect(link.getAttribute("href")).toContain(hash);
    expect(link.getAttribute("title")).toContain(hash);
  });
});
