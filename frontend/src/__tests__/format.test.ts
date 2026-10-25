import { describe, expect, it } from "vitest";
import { axisGw, gwh, signedGw, ukTime } from "../format";

describe("formatting", () => {
  it("shows axis ticks in GW without losing half steps", () => {
    expect(axisGw(1500)).toBe("1.5");
    expect(axisGw(20000)).toBe("20");
  });

  it("signs GW values with a true minus sign", () => {
    expect(signedGw(-1730)).toBe("−1.73 GW");
    expect(signedGw(500)).toBe("+0.50 GW");
    expect(signedGw(null)).toBe("–");
  });

  it("converts MWh to GWh", () => {
    expect(gwh(280272)).toBe("280 GWh");
  });

  it("displays times on the UK clock, including BST", () => {
    expect(ukTime("2026-01-15T09:30:00Z")).toBe("09:30");
    expect(ukTime("2026-07-15T09:30:00Z")).toBe("10:30");
  });
});
