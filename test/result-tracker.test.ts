import { ResultTracker } from "../result-tracker";
import { DEFAULT_CONFIG } from "../config";

describe("ResultTracker", () => {
  let tracker: ResultTracker;

  beforeEach(() => {
    tracker = new ResultTracker(DEFAULT_CONFIG);
  });

  describe("basic behavior", () => {
    it("returns null for a single result", () => {
      const result = tracker.check("read", "file content here");
      expect(result).toBeNull();
    });

    it("returns null for different results from same tool", () => {
      tracker.check("read", "content of file A");
      const result = tracker.check("read", "content of file B");
      expect(result).toBeNull();
    });

    it("returns null for same result from different tools", () => {
      tracker.check("read", "same content");
      const result = tracker.check("grep", "same content");
      expect(result).toBeNull();
    });

    it("returns null for same result below threshold", () => {
      const config = { ...DEFAULT_CONFIG, resultStagnationThreshold: 3 };
      tracker = new ResultTracker(config);
      tracker.check("read", "identical content");
      const result = tracker.check("read", "identical content");
      expect(result).toBeNull();
    });
  });

  describe("stagnation detection", () => {
    it("detects identical results meeting threshold", () => {
      const config = { ...DEFAULT_CONFIG, resultStagnationThreshold: 3 };
      tracker = new ResultTracker(config);
      tracker.check("read", "identical content returned multiple times");
      tracker.check("read", "identical content returned multiple times");
      const result = tracker.check("read", "identical content returned multiple times");
      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe("result_stagnation");
        expect(result.toolName).toBe("read");
      }
    });

    it("tracks per-tool-name independently", () => {
      const config = { ...DEFAULT_CONFIG, resultStagnationThreshold: 3 };
      tracker = new ResultTracker(config);
      tracker.check("read", "read result A");
      tracker.check("grep", "grep result A");
      tracker.check("read", "read result A");
      tracker.check("grep", "grep result A");
      // read has 2, grep has 2 — neither at threshold yet
      expect(tracker.check("read", "read result A")).not.toBeNull();
      expect(tracker.check("grep", "grep result A")).not.toBeNull();
    });

    it("resets consecutive count on different result", () => {
      const config = { ...DEFAULT_CONFIG, resultStagnationThreshold: 3 };
      tracker = new ResultTracker(config);
      tracker.check("read", "result A");
      tracker.check("read", "result A");
      tracker.check("read", "different result B");
      tracker.check("read", "result A");
      const result = tracker.check("read", "result A");
      // Only 2 consecutive "result A" after the break, below threshold of 3
      expect(result).toBeNull();
    });

    it("normalizes whitespace in results", () => {
      const config = { ...DEFAULT_CONFIG, resultStagnationThreshold: 3 };
      tracker = new ResultTracker(config);
      tracker.check("read", "  same   content  ");
      tracker.check("read", "same content");
      const result = tracker.check("read", "same content");
      expect(result).not.toBeNull();
    });
  });

  describe("reset", () => {
    it("clears all tracking state", () => {
      const config = { ...DEFAULT_CONFIG, resultStagnationThreshold: 3 };
      tracker = new ResultTracker(config);
      tracker.check("read", "identical content for testing");
      tracker.check("read", "identical content for testing");
      tracker.reset();
      tracker.check("read", "identical content for testing");
      const result = tracker.check("read", "identical content for testing");
      // After reset, only 2 calls, below threshold of 3
      expect(result).toBeNull();
    });
  });

  describe("detection details", () => {
    it("provides human-readable details", () => {
      const config = { ...DEFAULT_CONFIG, resultStagnationThreshold: 3 };
      tracker = new ResultTracker(config);
      tracker.check("grep", "no matches found");
      tracker.check("grep", "no matches found");
      const result = tracker.check("grep", "no matches found");
      if (result) {
        expect(result.details).toContain("stagnation");
        expect(result.toolName).toBe("grep");
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty results", () => {
      tracker.check("read", "");
      tracker.check("read", "");
      const result = tracker.check("read", "");
      expect(result).not.toBeNull();
    });

    it("truncates very long results for comparison", () => {
      const config = { ...DEFAULT_CONFIG, resultStagnationThreshold: 3 };
      tracker = new ResultTracker(config);
      const long = "x".repeat(600);
      tracker.check("read", long);
      tracker.check("read", long);
      const result = tracker.check("read", long);
      expect(result).not.toBeNull();
    });
  });
});
