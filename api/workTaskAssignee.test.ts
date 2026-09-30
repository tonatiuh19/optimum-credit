import { describe, expect, it } from "vitest";
import { matchStaffAdmins } from "./index";

const STAFF = [
  {
    id: 30001,
    first_name: "Alex",
    last_name: "Gomez",
    email: "axgoomez@gmail.com",
  },
  {
    id: 90001,
    first_name: "Cesar",
    last_name: "Gomez",
    email: "cesar@optimum-financial-group.com",
  },
  {
    id: 150002,
    first_name: "Lecca",
    last_name: "Bustamante",
    email: "lecca@optimum-financial-group.com",
  },
  {
    id: 120001,
    first_name: "Angel",
    last_name: "Alvarez",
    email: "angel@optimum-financial-group.com",
  },
];

describe("matchStaffAdmins", () => {
  it("resolves full name to Alex, not the English language owner", () => {
    const hits = matchStaffAdmins(STAFF, "Alex Gomez");
    expect(hits.map((r) => r.id)).toEqual([30001]);
  });

  it("resolves unique first name", () => {
    expect(matchStaffAdmins(STAFF, "alex").map((r) => r.id)).toEqual([30001]);
    expect(matchStaffAdmins(STAFF, "Lecca").map((r) => r.id)).toEqual([150002]);
  });

  it("does not collapse Gomez to a single person", () => {
    const hits = matchStaffAdmins(STAFF, "Gomez");
    expect(hits.map((r) => r.id).sort()).toEqual([30001, 90001]);
  });

  it("matches email exactly", () => {
    expect(
      matchStaffAdmins(STAFF, "axgoomez@gmail.com").map((r) => r.id),
    ).toEqual([30001]);
  });

  it("returns empty for unknown staff", () => {
    expect(matchStaffAdmins(STAFF, "Maggie")).toEqual([]);
  });

  it("maps Lika nickname to Lecca", () => {
    expect(matchStaffAdmins(STAFF, "Lika").map((r) => r.id)).toEqual([150002]);
    expect(matchStaffAdmins(STAFF, "lika bustamante").map((r) => r.id)).toEqual(
      [150002],
    );
  });
});
