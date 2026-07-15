import { findPatterns } from "./patterns.ts";
import { parseBoard } from "./test-helpers/parse-board.ts";

describe("findPatterns — five", () => {
  it("finds a five with no gains", () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    const patterns = findPatterns(board, 1);
    const fives = patterns.filter((p) => p.type === "five");
    expect(fives).toHaveLength(1);
    expect(fives[0].gains).toEqual([]);
    expect(fives[0].cells.map((c) => `${c.row},${c.col}`).sort()).toEqual(
      [1, 2, 3, 4, 5].map((col) => `1,${col}`).sort(),
    );
  });

  it("does not report a five for an overline (six in a row)", () => {
    const board = parseBoard(`
      ........
      .XXXXXX.
      ........
    `);
    const patterns = findPatterns(board, 1);
    expect(patterns.filter((p) => p.type === "five")).toHaveLength(0);
  });

  it("does not report a five blocked at both ends", () => {
    const board = parseBoard("OXXXXXO");
    const patterns = findPatterns(board, 1);
    expect(patterns.filter((p) => p.type === "five")).toHaveLength(0);
  });

  it("finds no patterns for the opponent on a board with only one player's stones", () => {
    const board = parseBoard(`
      .......
      .XXXXX.
      .......
    `);
    expect(findPatterns(board, 2)).toEqual([]);
  });
});

describe("findPatterns — four / open-four", () => {
  it("classifies a four with two open ends as open-four", () => {
    const board = parseBoard(".XXXX.");
    const patterns = findPatterns(board, 1);
    const fours = patterns.filter((p) => p.type === "open-four");
    expect(fours).toHaveLength(1);
    expect(fours[0].gains.map((g) => g.col).sort()).toEqual([0, 5]);
    expect(fours[0].criticalGains).toEqual(fours[0].gains);
  });

  it("classifies a four blocked at one end as a plain four with one win square", () => {
    const board = parseBoard("OXXXX.");
    const patterns = findPatterns(board, 1);
    const fours = patterns.filter((p) => p.type === "four");
    expect(fours).toHaveLength(1);
    expect(fours[0].gains.map((g) => g.col)).toEqual([5]);
  });

  it("reports no four when blocked at both ends", () => {
    const board = parseBoard("OXXXXO");
    const patterns = findPatterns(board, 1);
    expect(
      patterns.filter((p) => p.type === "four" || p.type === "open-four"),
    ).toHaveLength(0);
  });
});

describe("findPatterns — three / open-three (design doc worked examples)", () => {
  it("OXXX. classifies as three: only simple fours are reachable", () => {
    // Width matters here: with WIN_LENGTH=5, "OXXX." (5 cols) has exactly one
    // sliding window and it contains the O, so nothing would be found at all.
    // The extra trailing "." gives a second window that excludes the O.
    const board = parseBoard("OXXX..");
    const patterns = findPatterns(board, 1);
    const threes = patterns.filter((p) => p.type === "three");
    expect(threes).toHaveLength(1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(0);
  });

  it("O.XXX. classifies as open-three: the right end yields two win squares", () => {
    // Same width issue as above: "O.XXX." (6 cols) has only one O-free
    // window, which caps the reachable four at one open end (blocked by the
    // board edge on the other) — never open-four. The extra trailing "."
    // gives col 5's gain room to open on both flanks.
    const board = parseBoard("O.XXX..");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(1);
    // Filling col 1 only yields a blocked four (O is beyond it); only col 5 opens up to open-four.
    expect(opens[0].criticalGains.map((g) => g.col)).toEqual([5]);
  });

  it("O..XXX. classifies as open-three through the gaps", () => {
    const board = parseBoard("O..XXX.");
    const patterns = findPatterns(board, 1);
    const opens = patterns.filter((p) => p.type === "open-three");
    expect(opens).toHaveLength(1);
  });

  it("O.XXXO reports no three: no viable window exists", () => {
    const board = parseBoard("O.XXXO");
    const patterns = findPatterns(board, 1);
    expect(
      patterns.filter((p) => p.type === "three" || p.type === "open-three"),
    ).toHaveLength(0);
  });
});
