import { describe, expect, it } from "vitest";
import { toCsv } from "../csv";

describe("toCsv", () => {
  it("writes a header row and rounds numbers to 2 dp", () => {
    expect(toCsv([{ time: "2026-01-15T00:00:00Z", mw: 1234.5678 }])).toBe("time,mw\n2026-01-15T00:00:00Z,1234.57");
  });

  it("leaves nulls empty and quotes values containing commas or quotes", () => {
    expect(toCsv([{ a: null, b: 'say "hi", ok' }])).toBe('a,b\n,"say ""hi"", ok"');
  });

  it("returns an empty string for no rows", () => {
    expect(toCsv([])).toBe("");
  });
});
