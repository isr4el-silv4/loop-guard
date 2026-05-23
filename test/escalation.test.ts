import { EscalationManager } from "../escalation";
import { DEFAULT_CONFIG } from "../config";
import type { ToolLoopDetection } from "../tool-tracker";
import type { ThinkingLoopDetection } from "../thinking-tracker";
import type { ResultStagnationDetection } from "../result-tracker";

describe("EscalationManager", () => {
  let mgr: EscalationManager;

  beforeEach(() => {
    mgr = new EscalationManager(DEFAULT_CONFIG);
  });

  describe("basic behavior", () => {
    it("starts with no action", () => {
      const action = mgr.record({
        type: "exact",
        toolName: "read",
        consecutiveCount: 2,
        details: "exact repeat",
      });
      expect(action.level).toBe("hint");
    });

    it("returns hint after first detection (hintAfter: 1)", () => {
      const action = mgr.record({
        type: "exact",
        toolName: "read",
        consecutiveCount: 2,
        details: "exact repeat",
      });
      expect(action.level).toBe("hint");
      if (action.level === "hint") {
        expect(action.message).toContain("Loop detected");
      }
    });

    it("returns block after blockAfter detections", () => {
      const config = { ...DEFAULT_CONFIG, hintAfter: 1, blockAfter: 3 };
      mgr = new EscalationManager(config);
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d1" });
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d2" });
      const action = mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d3" });
      expect(action.level).toBe("block");
      if (action.level === "block") {
        expect(action.reason).toContain("Blocked");
      }
    });
  });

  describe("escalation ladder", () => {
    it("progresses: none → hint → block → terminate", () => {
      const config = { ...DEFAULT_CONFIG, hintAfter: 1, blockAfter: 2, blockBeforeTerminate: 2 };
      mgr = new EscalationManager(config);

      // Detection 1: hint (>= hintAfter=1, < blockAfter=2)
      const a1 = mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d1" });
      expect(a1.level).toBe("hint");

      // Detection 2: block (>= blockAfter=2)
      const a2 = mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d2" });
      expect(a2.level).toBe("block");

      // Detection 3: terminate (> blockAfter + blockBeforeTerminate - 1 = 3)
      const a3 = mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d3" });
      expect(a3.level).toBe("block"); // still in block range

      // Detection 4: terminate
      const a4 = mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d4" });
      expect(a4.level).toBe("terminate");
    });
  });

  describe("system prompt hint", () => {
    it("returns null before any detections", () => {
      expect(mgr.getSystemPromptHint()).toBeNull();
    });

    it("returns hint string after detection", () => {
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d1" });
      const hint = mgr.getSystemPromptHint();
      expect(hint).not.toBeNull();
      expect(hint).toContain("Loop detected");
    });
  });

  describe("shouldTerminate", () => {
    it("returns false initially", () => {
      expect(mgr.shouldTerminate()).toBe(false);
    });

    it("returns true after termination threshold", () => {
      const config = { ...DEFAULT_CONFIG, hintAfter: 1, blockAfter: 2, blockBeforeTerminate: 2 };
      mgr = new EscalationManager(config);
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d1" });
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d2" });
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d3" });
      expect(mgr.shouldTerminate()).toBe(false);
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d4" });
      expect(mgr.shouldTerminate()).toBe(true);
    });
  });

  describe("reset", () => {
    it("clears all escalation state", () => {
      const config = { ...DEFAULT_CONFIG, hintAfter: 1, blockAfter: 2 };
      mgr = new EscalationManager(config);
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d1" });
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d2" });
      mgr.reset();
      expect(mgr.shouldTerminate()).toBe(false);
      expect(mgr.getSystemPromptHint()).toBeNull();
      const action = mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d1" });
      expect(action.level).toBe("hint");
    });
  });

  describe("getSummary", () => {
    it("returns empty string before detections", () => {
      expect(mgr.getSummary()).toBe("");
    });

    it("returns summary after detections", () => {
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d1" });
      mgr.record({ type: "fuzzy", toolName: "grep", consecutiveCount: 3, details: "d2" });
      const summary = mgr.getSummary();
      expect(summary).toContain("2 detections");
    });
  });

  describe("terminate message includes reset hint", () => {
    it("includes /loop-guard reset instruction in terminate reason", () => {
      const config = { ...DEFAULT_CONFIG, hintAfter: 1, blockAfter: 2, blockBeforeTerminate: 2 };
      mgr = new EscalationManager(config);
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d1" });
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d2" });
      mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d3" });
      const action = mgr.record({ type: "exact", toolName: "read", consecutiveCount: 2, details: "d4" });
      expect(action.level).toBe("terminate");
      if (action.level === "terminate") {
        expect(action.reason).toContain("/loop-guard reset");
      }
    });
  });

  describe("handles different detection types", () => {
    it("handles tool loop detection", () => {
      const detection: ToolLoopDetection = {
        type: "exact",
        toolName: "read",
        consecutiveCount: 2,
        details: "exact repeat",
      };
      const action = mgr.record(detection);
      expect(action.level).toBe("hint");
    });

    it("handles thinking loop detection", () => {
      const detection: ThinkingLoopDetection = {
        type: "repetitive",
        consecutiveCount: 3,
        details: "repetitive thinking",
      };
      const action = mgr.record(detection);
      expect(action.level).toBe("hint");
    });

    it("handles result stagnation detection", () => {
      const detection: ResultStagnationDetection = {
        type: "result_stagnation",
        toolName: "read",
        consecutiveCount: 3,
        details: "result stagnation",
      };
      const action = mgr.record(detection);
      expect(action.level).toBe("hint");
    });
  });
});
