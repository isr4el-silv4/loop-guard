import type { LoopGuardConfig } from "./config";

/**
 * Describes a detected result stagnation.
 */
export interface ResultStagnationDetection {
  type: "result_stagnation";
  toolName: string;
  consecutiveCount: number;
  details: string;
}

/**
 * Detect result stagnation — same tool returning the same result repeatedly.
 */
export class ResultTracker {
  private recentResults: Map<string, string[]> = new Map();

  constructor(private config: LoopGuardConfig) {}

  /**
   * Record a tool result and check for stagnation.
   * Returns a detection result or null if no stagnation found.
   */
  check(toolName: string, resultText: string): ResultStagnationDetection | null {
    // Normalize: trim, collapse whitespace, truncate to 500 chars
    const normalized = resultText.trim().replace(/\s+/g, " ").slice(0, 500);

    const results = this.recentResults.get(toolName) || [];

    // Count consecutive identical results from the end
    let count = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] === normalized) {
        count++;
      } else {
        break;
      }
    }

    // Record this result
    results.push(normalized);
    // Keep only the last N entries
    const window = this.config.resultStagnationThreshold;
    if (results.length > window) {
      results.splice(0, results.length - window);
    }
    this.recentResults.set(toolName, results);

    if (count >= this.config.resultStagnationThreshold - 1) {
      return {
        type: "result_stagnation",
        toolName,
        consecutiveCount: count + 1, // +1 for the current call
        details: `result stagnation detected: ${toolName} returned the same result ${count + 1} times consecutively.`,
      };
    }

    return null;
  }

  /** Reset tracking state. */
  reset(): void {
    this.recentResults = new Map();
  }
}
