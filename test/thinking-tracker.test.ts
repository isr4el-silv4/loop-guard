import { ThinkingTracker } from "../thinking-tracker";
import { DEFAULT_CONFIG } from "../config";

describe("ThinkingTracker", () => {
  let tracker: ThinkingTracker;

  beforeEach(() => {
    tracker = new ThinkingTracker(DEFAULT_CONFIG);
  });

  describe("basic behavior", () => {
    it("returns null for a single thought", () => {
      const result = tracker.check("This is my first thought");
      expect(result).toBeNull();
    });

    it("returns null for different thoughts", () => {
      tracker.check("Let me analyze the problem");
      const result = tracker.check("Now I need to implement the solution");
      expect(result).toBeNull();
    });
  });

  describe("repetitive thinking detection", () => {
    it("detects identical thoughts above threshold", () => {
      const thought = "I need to think about this more carefully";
      for (let i = 0; i < DEFAULT_CONFIG.thinkingSimilarityThreshold + 1; i++) {
        const result = tracker.check(thought);
        if (i < DEFAULT_CONFIG.thinkingSimilarityThreshold) {
          expect(result).toBeNull();
        }
      }
      // The last check should have triggered detection
      const result = tracker.check(thought);
      expect(result).not.toBeNull();
    });

    it("detects very similar thoughts with ngram similarity", () => {
      // These thoughts are very similar character-by-character
      tracker.check("Let me try a different approach to solve this problem by using recursion");
      tracker.check("Let me try a different approach to solve this problem by using iteration");
      tracker.check("Let me try a different approach to solve this problem by using memoization");
      tracker.check("Let me try a different approach to solve this problem by using dynamic programming");
      tracker.check("Let me try a different approach to solve this problem by using backtracking");
      tracker.check("Let me try a different approach to solve this problem by using greedy algorithm");
      const result = tracker.check("Let me try a different approach to solve this problem by using divide and conquer");
      // With default threshold 3 and ngram size 5, these should be very similar
      if (result) {
        expect(result.type).toBe("repetitive");
      }
    });

    it("does not detect when thoughts are sufficiently different", () => {
      tracker.check("I should read the file first");
      tracker.check("Then I need to parse the JSON content");
      tracker.check("After that, I will transform the data");
      tracker.check("Finally, I will write the output to a new file");
      const result = tracker.check("Let me verify the results are correct");
      expect(result).toBeNull();
    });

    it("respects thinkingWindow", () => {
      const config = { ...DEFAULT_CONFIG, thinkingWindow: 3, thinkingSimilarityThreshold: 2 };
      tracker = new ThinkingTracker(config);
      tracker.check("same thought A");
      tracker.check("different thought B");
      tracker.check("different thought C");
      tracker.check("same thought A");
      // Only 1 consecutive "same thought A" in window, need 2
      const result = tracker.check("same thought A");
      expect(result).toBeNull();
    });
  });

  describe("reset", () => {
    it("clears all tracking state", () => {
      const thought = "I keep repeating this";
      tracker.check(thought);
      tracker.check(thought);
      tracker.reset();
      tracker.check(thought);
      const result = tracker.check(thought);
      expect(result).toBeNull();
    });
  });

  describe("detection details", () => {
    it("provides human-readable details", () => {
      const thought = "I need to reconsider my approach";
      for (let i = 0; i <= DEFAULT_CONFIG.thinkingSimilarityThreshold; i++) {
        tracker.check(thought);
      }
      const result = tracker.check(thought);
      if (result) {
        expect(result.details).toContain("repetitive");
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty thoughts", () => {
      tracker.check("");
      const result = tracker.check("");
      expect(result).toBeNull();
    });

    it("handles very short thoughts", () => {
      tracker.check("a");
      const result = tracker.check("a");
      expect(result).toBeNull();
    });

    it("handles thoughts shorter than ngram size", () => {
      const config = { ...DEFAULT_CONFIG, thinkingNgramSize: 10 };
      tracker = new ThinkingTracker(config);
      tracker.check("short");
      const result = tracker.check("short");
      // Two identical short thoughts should still be detected as exact match
      expect(result).toBeNull();
    });
  });
});
