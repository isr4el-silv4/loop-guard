import type { LoopGuardConfig } from "./config";
import type { ToolLoopDetection } from "./tool-tracker";
import type { ThinkingLoopDetection } from "./thinking-tracker";
import type { ResultStagnationDetection } from "./result-tracker";

/**
 * Any loop detection from any tracker.
 */
export type LoopDetection =
  | ToolLoopDetection
  | ThinkingLoopDetection
  | ResultStagnationDetection;

/**
 * Escalation action returned by record().
 */
export type EscalationAction =
  | { level: "none" }
  | { level: "hint"; message: string }
  | { level: "block"; reason: string }
  | { level: "terminate"; reason: string };

// ── System prompt hints (progressively stronger) ──

const HINT_LEVEL_1 =
  "⚠ Loop detected: You appear to be repeating the same action or reasoning pattern.\n" +
  "Try a different approach — consider what information you're missing or what alternative tool might help.";

const HINT_LEVEL_2 =
  "⚠ Loop detected (continued): You are repeating the same pattern again.\n" +
  "Stop the current approach. Analyze what has already been done and choose a distinctly different next step.\n" +
  "If you have enough information to answer, do so now.";

const HINT_BLOCK =
  "🚫 Blocked: Repeated loop detected. The same action has been attempted multiple times without progress.\n" +
  "You must try a fundamentally different approach or conclude with the information available.";

/**
 * Manage escalation state per detection type and generate corrective messages.
 */
export class EscalationManager {
  private detectionCount = 0;
  private detections: LoopDetection[] = [];

  constructor(private config: LoopGuardConfig) {}

  /**
   * Record a detection and return the current escalation action.
   */
  record(detection: LoopDetection): EscalationAction {
    this.detectionCount++;
    this.detections.push(detection);

    if (this.shouldTerminate()) {
      return {
        level: "terminate",
        reason: `🛑 Agent terminated: loop-guard detected persistent looping behavior after ${this.detectionCount} attempts.\nRun /loop-guard reset to continue.`,
      };
    }

    if (this.detectionCount >= this.config.blockAfter) {
      return {
        level: "block",
        reason: HINT_BLOCK,
      };
    }

    if (this.detectionCount >= this.config.hintAfter) {
      // Choose hint level based on how many hints we've given
      const hintLevel = this.detectionCount >= this.config.hintAfter + 1 ? HINT_LEVEL_2 : HINT_LEVEL_1;
      return {
        level: "hint",
        message: hintLevel,
      };
    }

    return { level: "none" };
  }

  /**
   * Get the system prompt hint to inject, based on current escalation state.
   * Returns null if no hint needed.
   */
  getSystemPromptHint(): string | null {
    if (this.detectionCount < this.config.hintAfter) {
      return null;
    }

    if (this.detectionCount >= this.config.blockAfter) {
      return HINT_BLOCK;
    }

    const hintLevel = this.detectionCount >= this.config.hintAfter + 1 ? HINT_LEVEL_2 : HINT_LEVEL_1;
    return hintLevel;
  }

  /**
   * Check if the agent should be terminated.
   */
  shouldTerminate(): boolean {
    return this.detectionCount > this.config.blockAfter + this.config.blockBeforeTerminate - 1;
  }

  /**
   * Reset all escalation counters.
   */
  reset(): void {
    this.detectionCount = 0;
    this.detections = [];
  }

  /**
   * Get a summary of the current loop state for user notification.
   */
  getSummary(): string {
    if (this.detectionCount === 0) return "";
    return `${this.detectionCount} detections: ${this.detections.map(d => d.details).join("; ")}`;
  }
}
