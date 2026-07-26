import { parallelismFor, DIFFICULTY_PROFILES } from "./engine.ts";

describe("parallelismFor", () => {
  it("defaults to 1 for non-parallel difficulties", () => {
    expect(parallelismFor("easy")).toBe(1);
    expect(parallelismFor("medium")).toBe(1);
    expect(parallelismFor("hard")).toBe(1);
  });

  it("reports expert's configured fan-out width", () => {
    expect(parallelismFor("expert")).toBe(3);
  });

  it("expert searches deeper than hard", () => {
    expect(DIFFICULTY_PROFILES.expert.maxDepth).toBeGreaterThan(DIFFICULTY_PROFILES.hard.maxDepth);
  });
});
