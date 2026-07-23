import { zobristTerm, SIDE_TO_MOVE_KEY } from "./zobrist.ts";

describe("zobrist", () => {
  it("gives distinct, stable, nonzero terms per cell/player", () => {
    const a = zobristTerm(3, 4, 1);
    const b = zobristTerm(3, 4, 2);
    const c = zobristTerm(4, 3, 1);
    expect(a).not.toBe(0n);
    expect(a).not.toBe(b); // same cell, different player
    expect(a).not.toBe(c); // different cell
    expect(zobristTerm(3, 4, 1)).toBe(a); // stable within a run
    expect(a >> 64n).toBe(0n); // fits in 64 bits
    expect(SIDE_TO_MOVE_KEY).not.toBe(0n);
  });
});
