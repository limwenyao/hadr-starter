import { describe, it, expect } from "vitest";
import { shouldAssess } from "../src/assessment/gate.js";

describe("shouldAssess (deterministic quiet-gate — rules decide, not the model)", () => {
  it("assesses when forced, regardless of the verdict", () => {
    expect(shouldAssess({ new: 0, revised: 0, withdrawn: 0 }, true)).toBe(true);
  });

  it("assesses on the first run (no prior snapshot → null verdict)", () => {
    expect(shouldAssess(null, false)).toBe(true);
  });

  it("assesses when any of new/revised/withdrawn is non-zero", () => {
    expect(shouldAssess({ new: 1, revised: 0, withdrawn: 0 }, false)).toBe(true);
    expect(shouldAssess({ new: 0, revised: 2, withdrawn: 0 }, false)).toBe(true);
    expect(shouldAssess({ new: 0, revised: 0, withdrawn: 3 }, false)).toBe(true);
  });

  it("stays quiet when nothing changed and not forced", () => {
    expect(shouldAssess({ new: 0, revised: 0, withdrawn: 0 }, false)).toBe(false);
  });
});
