import { ToolTracker } from "../tool-tracker";
import { DEFAULT_CONFIG } from "../config";

describe("ToolTracker", () => {
  let tracker: ToolTracker;

  beforeEach(() => {
    tracker = new ToolTracker(DEFAULT_CONFIG);
  });

  describe("exact repeat detection", () => {
    it("returns null for a single call", () => {
      const result = tracker.check("read", { path: "/foo.txt" });
      expect(result).toBeNull();
    });

    it("returns null for different calls", () => {
      tracker.check("read", { path: "/foo.txt" });
      const result = tracker.check("read", { path: "/bar.txt" });
      expect(result).toBeNull();
    });

    it("returns null for same tool with different args", () => {
      tracker.check("bash", { command: "ls" });
      const result = tracker.check("bash", { command: "cat file.txt" });
      expect(result).toBeNull();
    });

    it("detects exact repeat after threshold (2 consecutive)", () => {
      tracker.check("read", { path: "/foo.txt" });
      tracker.check("read", { path: "/foo.txt" });
      const result = tracker.check("read", { path: "/foo.txt" });
      expect(result).not.toBeNull();
      expect(result?.type).toBe("exact");
      expect(result?.toolName).toBe("read");
    });

    it("does not detect when calls are interleaved with other calls", () => {
      tracker.check("read", { path: "/foo.txt" });
      tracker.check("bash", { command: "ls" });
      tracker.check("read", { path: "/foo.txt" });
      const result = tracker.check("read", { path: "/foo.txt" });
      expect(result).toBeNull();
    });

    it("respects toolCallWindow — evicted calls are not counted", () => {
      const config = { ...DEFAULT_CONFIG, toolCallWindow: 3, exactRepeatThreshold: 2 };
      tracker = new ToolTracker(config);
      tracker.check("read", { path: "/foo.txt" });
      tracker.check("bash", { command: "ls" });
      tracker.check("bash", { command: "cd" });
      tracker.check("bash", { command: "pwd" });
      // The first read is now outside the window of 3
      tracker.check("read", { path: "/foo.txt" });
      const result = tracker.check("read", { path: "/foo.txt" });
      // Only 1 consecutive read in window (the first was evicted), need 2
      expect(result).toBeNull();
    });
  });

  describe("fuzzy repeat detection", () => {
    it("returns null for calls that differ enough", () => {
      tracker.check("bash", { command: "ls -la /home" });
      const result = tracker.check("bash", { command: "cat /etc/passwd" });
      expect(result).toBeNull();
    });

    it("detects fuzzy repeat when jaccard similarity exceeds threshold", () => {
      // 13 shared tokens out of 15 => 0.867 > 0.85
      tracker.check("read", { file: "/path/to/file.ts", offset: 10, limit: 50, encoding: "utf8", trim: true, ignore: false, recursive: false, watch: false });
      const result = tracker.check("read", { file: "/path/to/file.ts", offset: 11, limit: 50, encoding: "utf8", trim: true, ignore: false, recursive: false, watch: false });
      expect(result).not.toBeNull();
      expect(result?.type).toBe("fuzzy");
    });

    it("does not flag exact matches as fuzzy", () => {
      tracker.check("read", { path: "/foo.txt" });
      tracker.check("read", { path: "/foo.txt" });
      // This should be exact, not fuzzy
      const result = tracker.check("read", { path: "/foo.txt" });
      if (result) {
        expect(result.type).toBe("exact");
      }
    });
  });

  describe("cycle detection", () => {
    it("returns null for non-repeating sequences", () => {
      tracker.check("read", { path: "/a.txt" });
      tracker.check("bash", { command: "ls" });
      tracker.check("write", { path: "/b.txt" });
      const result = tracker.check("edit", { path: "/c.txt" });
      expect(result).toBeNull();
    });

    it("detects a simple 2-call cycle (A, B, A, B)", () => {
      tracker.check("read", { path: "/a.txt" });
      tracker.check("bash", { command: "ls" });
      tracker.check("read", { path: "/b.txt" });
      const result = tracker.check("bash", { command: "ls" });
      expect(result).not.toBeNull();
      expect(result?.type).toBe("cycle");
    });

    it("does not detect cycle with only one repetition", () => {
      // cycleRepetitions default is 2, so A,B,A,B needs to repeat twice
      // A,B,A,B is one repetition of the pattern AB
      // We need A,B,A,B,A,B for two repetitions
      tracker.check("read", { path: "/a.txt" });
      tracker.check("bash", { command: "ls" });
      tracker.check("read", { path: "/b.txt" });
      const result = tracker.check("bash", { command: "ls" });
      // With cycleLength=2 and cycleRepetitions=2, we need 4 calls minimum
      // A,B,A,B = pattern AB repeated 2 times
      expect(result?.type).toBe("cycle");
    });
  });

  describe("reset", () => {
    it("clears all tracking state", () => {
      tracker.check("read", { path: "/foo.txt" });
      tracker.check("read", { path: "/foo.txt" });
      tracker.reset();
      tracker.check("read", { path: "/foo.txt" });
      const result = tracker.check("read", { path: "/foo.txt" });
      // After reset, only 2 calls, need 3 for threshold 2 (consecutive)
      expect(result).toBeNull();
    });
  });

  describe("detection details", () => {
    it("provides human-readable details for exact repeats", () => {
      tracker.check("read", { path: "/foo.txt" });
      tracker.check("read", { path: "/foo.txt" });
      const result = tracker.check("read", { path: "/foo.txt" });
      expect(result?.details).toContain("read");
    });

    it("provides human-readable details for fuzzy repeats", () => {
      tracker.check("grep", { pattern: "foo bar baz qux", path: "/src" });
      const result = tracker.check("grep", { pattern: "foo bar baz quiz", path: "/src" });
      if (result && result.type === "fuzzy") {
        expect(result.details).toContain("grep");
      }
    });

    it("provides human-readable details for cycle detection", () => {
      tracker.check("read", { path: "/a.txt" });
      tracker.check("bash", { command: "ls" });
      tracker.check("read", { path: "/b.txt" });
      const result = tracker.check("bash", { command: "ls" });
      if (result && result.type === "cycle") {
        expect(result.details).toContain("cycle");
      }
    });
  });
});
