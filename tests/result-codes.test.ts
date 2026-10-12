import { describe, expect, it } from "vitest";
import { mapProviderResult } from "@/lib/providers/khfypay/result-codes";

describe("mapProviderResult", () => {
  it("0 => SUCCESS, 1 => FAILED (number or string)", () => {
    expect(mapProviderResult(0)).toBe("SUCCESS");
    expect(mapProviderResult("0")).toBe("SUCCESS");
    expect(mapProviderResult(1)).toBe("FAILED");
    expect(mapProviderResult(" 1 ")).toBe("FAILED");
  });
  it("anything else is UNKNOWN and must never finalize", () => {
    for (const v of [2, "2", "", null, undefined, "00", "success", true, {}, NaN]) {
      expect(mapProviderResult(v)).toBe("UNKNOWN");
    }
  });
});
