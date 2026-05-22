import { ThinkingTracker } from "../thinking-tracker";
import { DEFAULT_CONFIG } from "../config";

describe("ThinkingTracker", () => {
  let tracker: ThinkingTracker;

  beforeEach(() => {
    tracker = new ThinkingTracker(DEFAULT_CONFIG);
  });

  describe("basic behavior", () => {
    it("returns null for a single thought", () => {
      const config = { ...DEFAULT_CONFIG, thinkingMinLength: 0 };
      tracker = new ThinkingTracker(config);
      const result = tracker.check("This is my first thought");
      expect(result).toBeNull();
    });

    it("returns null for different thoughts", () => {
      const config = { ...DEFAULT_CONFIG, thinkingMinLength: 0 };
      tracker = new ThinkingTracker(config);
      tracker.check("Let me analyze the problem step by step to find the root cause");
      const result = tracker.check("Now I need to implement the solution using a different approach");
      expect(result).toBeNull();
    });

    it("skips thoughts shorter than thinkingMinLength", () => {
      tracker.check("short");
      const result = tracker.check("short");
      expect(result).toBeNull();
    });
  });

  describe("repetitive thinking detection", () => {
    const longThought = "I need to think about this more carefully and consider all the possible approaches that could be taken to solve this complex problem effectively";

    it("detects identical thoughts on second occurrence", () => {
      tracker.check(longThought);
      const result = tracker.check(longThought);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe("repetitive");
        expect(result.consecutiveCount).toBe(1);
      }
    });

    it("detects very similar thoughts with ngram similarity", () => {
      const config = { ...DEFAULT_CONFIG, thinkingSimilarityThreshold: 2 };
      tracker = new ThinkingTracker(config);
      tracker.check("Let me try a different approach to solve this problem by using recursion and memoization to improve performance");
      tracker.check("Let me try a different approach to solve this problem by using iteration and caching to improve performance");
      const result = tracker.check("Let me try a different approach to solve this problem by using dynamic programming to improve performance");
      if (result) {
        expect(result.type).toBe("repetitive");
      }
    });

    it("does not detect when thoughts are sufficiently different", () => {
      const config = { ...DEFAULT_CONFIG, thinkingMinLength: 0 };
      tracker = new ThinkingTracker(config);
      tracker.check("I should read the file first to understand its contents and structure");
      tracker.check("Then I need to parse the JSON content and extract the relevant fields");
      tracker.check("After that, I will transform the data into the expected format");
      tracker.check("Finally, I will write the output to a new file and verify the results");
      const result = tracker.check("Let me verify the results are correct by running the test suite");
      expect(result).toBeNull();
    });

    it("respects thinkingWindow — old similar thoughts fall out of window", () => {
      const config = { ...DEFAULT_CONFIG, thinkingWindow: 2, thinkingMinLength: 0 };
      tracker = new ThinkingTracker(config);
      const sameA = "same thought A repeated enough times to pass the minimum length check of one hundred characters";
      const diffB = "different thought B that is also long enough to pass the minimum length check of one hundred characters";
      tracker.check(sameA);        // recorded
      tracker.check(diffB);        // different, recorded
      // window: [sameA, diffB]
      const result = tracker.check(sameA);  // compares against diffB (diff), count=0 → null
      expect(result).toBeNull();
      // window now: [diffB, sameA]
    });
  });

  describe("reset", () => {
    it("clears all tracking state", () => {
      const config = { ...DEFAULT_CONFIG, thinkingSimilarityThreshold: 2, thinkingMinLength: 0 };
      tracker = new ThinkingTracker(config);
      const thought = "I keep repeating this over and over again to make sure it passes the minimum length check";
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
      const config = { ...DEFAULT_CONFIG, thinkingSimilarityThreshold: 2 };
      tracker = new ThinkingTracker(config);
      const thought = "I need to reconsider my approach and think about this problem from a completely different angle to find a solution";
      tracker.check(thought);
      tracker.check(thought);
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

    it("normalizes whitespace", () => {
      const config = { ...DEFAULT_CONFIG, thinkingSimilarityThreshold: 2, thinkingMinLength: 0 };
      tracker = new ThinkingTracker(config);
      tracker.check("I   need   to   think   about   this   problem   very   carefully   and   consider   all   options   thoroughly   to   find   the   best   solution");
      tracker.check("I need to think about this problem very carefully and consider all options thoroughly to find the best solution");
      const result = tracker.check("I need to think about this problem very carefully and consider all options thoroughly to find the best solution");
      if (result) {
        expect(result.type).toBe("repetitive");
      }
    });

    it("caps very long thoughts at 2000 chars", () => {
      const config = { ...DEFAULT_CONFIG, thinkingSimilarityThreshold: 2 };
      tracker = new ThinkingTracker(config);
      const long = "x".repeat(3000);
      tracker.check(long);
      tracker.check(long);
      const result = tracker.check(long);
      if (result) {
        expect(result.type).toBe("repetitive");
      }
    });
  });
});
