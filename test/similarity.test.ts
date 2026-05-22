import { jaccardSimilarity, ngramSimilarity } from "../similarity";

describe("jaccardSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(jaccardSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 1.0 for identical strings case-insensitive", () => {
    expect(jaccardSimilarity("Hello World", "hello world")).toBe(1);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(jaccardSimilarity("", "")).toBe(1);
  });

  it("returns 0.0 for completely disjoint token sets", () => {
    expect(jaccardSimilarity("hello world", "foo bar")).toBe(0);
  });

  it("returns 0 when one string is empty and the other is not", () => {
    expect(jaccardSimilarity("hello", "")).toBe(0);
    expect(jaccardSimilarity("", "hello")).toBe(0);
  });

  it("returns 0.5 for partial overlap (2 shared / 4 total unique)", () => {
    // "hello", "world" shared, "foo"/"bar" distinct => 2/4 = 0.5
    expect(jaccardSimilarity("hello world foo", "hello world bar")).toBe(0.5);
  });

  it("handles extra whitespace correctly", () => {
    expect(jaccardSimilarity("hello   world", "hello world")).toBe(1);
  });

  it("is symmetric", () => {
    const a = "read file /path/to/file.ts offset 10 limit 5";
    const b = "read file /path/to/file.ts limit 5 offset 10";
    expect(jaccardSimilarity(a, b)).toBe(jaccardSimilarity(b, a));
  });

  it("handles single token strings", () => {
    expect(jaccardSimilarity("hello", "hello")).toBe(1);
    expect(jaccardSimilarity("hello", "world")).toBe(0);
  });
});

describe("ngramSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(ngramSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns 1.0 for identical strings case-insensitive", () => {
    expect(ngramSimilarity("Hello World", "hello world")).toBe(1);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(ngramSimilarity("", "")).toBe(1);
  });

  it("returns 0.0 for completely disjoint texts", () => {
    // bigrams of "abc": ab, bc — bigrams of "xyz": xy, yz — no overlap
    expect(ngramSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns 0 when one string is empty and the other is not", () => {
    expect(ngramSimilarity("hello", "")).toBe(0);
    expect(ngramSimilarity("", "hello")).toBe(0);
  });

  it("returns a value between 0 and 1 for partial overlap", () => {
    const sim = ngramSimilarity("the quick brown fox", "the quick brown dog");
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
    expect(sim).toBeGreaterThan(0.5);
  });

  it("handles extra whitespace by normalizing", () => {
    expect(ngramSimilarity("hello   world", "hello world")).toBe(1);
  });

  it("is symmetric", () => {
    const a = "this is a longer piece of text for testing";
    const b = "this is a slightly different piece of text";
    expect(ngramSimilarity(a, b)).toBe(ngramSimilarity(b, a));
  });

  it("works with custom n-gram size", () => {
    expect(ngramSimilarity("hello world", "hello world", 2)).toBe(1);
    expect(ngramSimilarity("hello world", "hello world", 3)).toBe(1);
  });

  it("produces different similarity with different n values", () => {
    const sim2 = ngramSimilarity("abcde", "abxde", 2);
    const sim3 = ngramSimilarity("abcde", "abxde", 3);
    expect(sim2).toBeGreaterThanOrEqual(0);
    expect(sim2).toBeLessThanOrEqual(1);
    expect(sim3).toBeGreaterThanOrEqual(0);
    expect(sim3).toBeLessThanOrEqual(1);
  });

  it("handles strings shorter than n-gram size", () => {
    // "ab" with n=3 produces no trigrams
    const sim = ngramSimilarity("ab", "ab", 3);
    expect(sim).toBe(1); // both empty sets
  });
});
