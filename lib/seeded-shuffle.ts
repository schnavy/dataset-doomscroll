/**
 * Feistel-cipher-based seeded shuffle for large datasets.
 *
 * Maps (seed, position) → dataset_row_index in O(1), with no full-shuffle
 * materialization. This is a permutation of [0, 2^32), cycle-walked into
 * [0, datasetSize). Same seed + same position always returns the same index.
 *
 * Why not Fisher-Yates: requires O(N) memory. For 10M-row datasets that's
 * ~40MB per process just for the shuffle array.
 *
 * Why not LCG: fixed stride through the dataset — every session steps the
 * same fraction of rows. Feistel has full-avalanche effect: one bit change
 * in seed or position flips ~half the output bits.
 */

function feistelRound(x: number, key: number): number {
  // Multiply-xor-shift mix on a 16-bit half.
  x = (Math.imul(x ^ key, 0x9e3779b9) >>> 0);
  return ((x ^ (x >>> 16)) >>> 0) & 0xffff;
}

function feistelEncrypt(value: number, seed: number): number {
  let L = (value >>> 16) & 0xffff;
  let R = value & 0xffff;

  // 4 round keys derived from seed via XOR with distinct constants.
  const keys = [
    (seed ^ 0xdeadbeef) >>> 0,
    (seed ^ 0xbaadf00d) >>> 0,
    (seed ^ 0xcafebabe) >>> 0,
    (seed ^ 0x8badf00d) >>> 0,
  ];

  for (const key of keys) {
    const newR = (L ^ feistelRound(R, key)) & 0xffff;
    L = R;
    R = newR;
  }

  return ((L << 16) | R) >>> 0;
}

/**
 * Maps a (seed, position) pair to a row index in [0, datasetSize).
 *
 * Cycle-walk: if the Feistel output >= datasetSize, encrypt again.
 * For datasetSize = 10_000_000 and range = 2^32, the expected number
 * of iterations is 1/(10M/2^32) ≈ 1.002 — almost always one shot.
 */
export function positionToRowIndex(
  seed: number,
  position: number,
  datasetSize: number,
): number {
  let candidate = feistelEncrypt(position >>> 0, seed >>> 0);
  let guard = 0;
  while (candidate >= datasetSize) {
    candidate = feistelEncrypt(candidate, seed >>> 0);
    if (++guard > 100) {
      // Pathological fallback — should never trigger in practice.
      return position % datasetSize;
    }
  }
  return candidate;
}

/**
 * Returns batchSize row indices starting at cursor position,
 * all deterministic for the given seed.
 */
export function getBatch(
  seed: number,
  cursor: number,
  batchSize: number,
  datasetSize: number,
): number[] {
  return Array.from({ length: batchSize }, (_, i) =>
    positionToRowIndex(seed, cursor + i, datasetSize),
  );
}
