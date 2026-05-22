/**
 * Zero-dependency text similarity functions.
 *
 * - `jaccardSimilarity` operates at the token level (whitespace split) and is used
 *   for comparing serialized tool arguments.
 * - `ngramSimilarity` operates at the character level (default n=2) and is used
 *   for comparing thinking/reasoning text blocks.
 */

/**
 * Jaccard similarity at token level (split by whitespace).
 * Returns 0.0 (no overlap) to 1.0 (identical token sets).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

/**
 * N-gram similarity at character level (default n=2).
 * Returns 0.0 (no overlap) to 1.0 (identical n-gram sets).
 */
export function ngramSimilarity(a: string, b: string, n: number = 2): number {
  const normalizedA = a.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedB = b.toLowerCase().replace(/\s+/g, " ").trim();

  const gramsA = getNgrams(normalizedA, n);
  const gramsB = getNgrams(normalizedB, n);

  if (gramsA.size === 0 && gramsB.size === 0) return 1;
  if (gramsA.size === 0 || gramsB.size === 0) return 0;

  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersection++;
  }

  const union = new Set([...gramsA, ...gramsB]).size;
  return intersection / union;
}

function getNgrams(text: string, n: number): Set<string> {
  const grams = new Set<string>();
  if (text.length < n) return grams;
  for (let i = 0; i <= text.length - n; i++) {
    grams.add(text.slice(i, i + n));
  }
  return grams;
}
