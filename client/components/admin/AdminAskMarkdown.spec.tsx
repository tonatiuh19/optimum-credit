import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminAskMarkdown from "./AdminAskMarkdown";

describe("AdminAskMarkdown", () => {
  it("renders bold and list markdown instead of raw asterisks", () => {
    render(
      <MemoryRouter>
        <AdminAskMarkdown content={"Hi **Optimum**\n\n- **Lookup** clients"} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Optimum").tagName).toBe("STRONG");
    expect(screen.getByText("Lookup").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*Optimum\*\*/)).toBeNull();
  });
});
