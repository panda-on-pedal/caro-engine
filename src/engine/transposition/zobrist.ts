import { BOARD_SIZE, type Player } from "../board.ts";

/** Deterministic 64-bit PRNG (SplitMix64) seeded from a fixed constant so
 *  every session — and every persisted TT slice — shares the same terms. */
function makeRng(seed: bigint): () => bigint {
  const MASK = 0xffffffffffffffffn;
  let state = seed & MASK;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return (z ^ (z >> 31n)) & MASK;
  };
}

const SEED = 0x0ca7_0ca7_0ca7_0ca7n;

/** table[row][col][playerIndex] — playerIndex 0 = player 1, 1 = player 2. */
const table: bigint[][][] = (() => {
  const rng = makeRng(SEED);
  const t: bigint[][][] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const rowArr: bigint[][] = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      rowArr.push([rng(), rng()]);
    }
    t.push(rowArr);
  }
  return t;
})();

export const SIDE_TO_MOVE_KEY: bigint = makeRng(SEED ^ 0xffffffffffffffffn)();

export function zobristTerm(row: number, col: number, player: Player): bigint {
  return table[row][col][player - 1];
}
