import { describe, expect, it } from "vitest";
import { classifyConversationMedia } from "./conversationMedia";

describe("classifyConversationMedia", () => {
  it("detects images", () => {
    expect(classifyConversationMedia("x.jpg", "image/jpeg")).toBe("image");
    expect(classifyConversationMedia("https://cdn/x.PNG", "")).toBe("image");
  });
  it("detects video audio pdf file", () => {
    expect(classifyConversationMedia("a.mp4", "video/mp4")).toBe("video");
    expect(classifyConversationMedia("a.mp3", "audio/mpeg")).toBe("audio");
    expect(classifyConversationMedia("a.pdf", "application/pdf")).toBe("pdf");
    expect(classifyConversationMedia("a.bin", "application/octet-stream")).toBe(
      "file",
    );
  });
});
