import { describe, expect, it } from "vitest";
import { buildCorsAllowedOrigins } from "./index";

describe("buildCorsAllowedOrigins", () => {
  it("always includes ofgllc production hosts and localhost", () => {
    const origins = buildCorsAllowedOrigins({
      appUrl: "https://optimum-credit.vercel.app",
      extraCsv: "",
      vercelUrl: "",
    });
    expect(origins).toContain("https://optimum-credit.vercel.app");
    expect(origins).toContain("https://www.ofgllc.com");
    expect(origins).toContain("https://ofgllc.com");
    expect(origins).toContain("http://localhost:8080");
  });

  it("merges CORS_ALLOWED_ORIGINS csv and Vercel URL", () => {
    const origins = buildCorsAllowedOrigins({
      appUrl: "https://www.ofgllc.com",
      extraCsv: "https://staging.example.com/, https://app.example.com",
      vercelUrl: "optimum-credit-git-main.vercel.app",
    });
    expect(origins).toContain("https://www.ofgllc.com");
    expect(origins).toContain("https://staging.example.com");
    expect(origins).toContain("https://app.example.com");
    expect(origins).toContain(
      "https://optimum-credit-git-main.vercel.app",
    );
  });

  it("strips trailing slashes", () => {
    const origins = buildCorsAllowedOrigins({
      appUrl: "https://www.ofgllc.com/",
      extraCsv: "",
      vercelUrl: "",
    });
    expect(origins).toContain("https://www.ofgllc.com");
    expect(origins).not.toContain("https://www.ofgllc.com/");
  });
});
