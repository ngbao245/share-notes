// ============================================================
// Canvas — chunks(arr, size) pure util
// ============================================================
//
// Split array thành sub-arrays kích thước tối đa `size`. Dùng cho
// batch operations qua workspace-proxy (rate limit 100 req/min +
// PATCH batch chunk 50 để không timeout 30s edge function).
// ============================================================

/**
 * Split array thành sub-arrays kích thước tối đa `size`.
 * Không mutate input.
 *
 * Example: chunks([1,2,3,4,5], 2) → [[1,2], [3,4], [5]]
 */
export function chunks<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunks: size must be > 0');
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
