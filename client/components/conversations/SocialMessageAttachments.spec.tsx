import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SocialMessageAttachments, socialMessageAttachments } from "@/components/conversations/SocialMessageAttachments";

describe("SocialMessageAttachments", () => {
  it("labels non-text Instagram content with a safe Open link", () => {
    render(
      <SocialMessageAttachments
        metadata={JSON.stringify({ attachments: [{ type: "story_mention", url: "https://cdn.example/s" }, { type: "unsupported", url: null }] })}
        mediaShown={false}
        outbound={false}
      />,
    );
    const box = screen.getByTestId("social-message-attachments");
    expect(box.textContent).toContain("Mentioned you in their story");
    expect(box.textContent).toContain("Content Meta can't show here");
    expect(box.querySelectorAll("a")).toHaveLength(1);
    expect(box.querySelector("a")?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("skips the image already shown as media, drops non-https links, renders nothing when empty", () => {
    expect(socialMessageAttachments({ attachments: [{ type: "share", url: "javascript:alert(1)" }] })).toEqual([{ type: "share", url: null }]);
    const { container } = render(
      <SocialMessageAttachments metadata={{ attachments: [{ type: "image", url: "https://cdn/i" }] }} mediaShown outbound />,
    );
    expect(container.innerHTML).toBe("");
  });
});
