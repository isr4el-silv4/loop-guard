import type { LoopGuardConfig } from "./config";
import { jaccardSimilarity } from "./similarity";

/**
 * Describes a detected tool call loop.
 */
export interface ToolLoopDetection {
  type: "exact" | "fuzzy" | "cycle";
  toolName: string;
  consecutiveCount: number;
  details: string;
}

/**
 * Internal signature for a tool call (normalized for comparison).
 */
interface ToolCallSignature {
  toolName: string;
  argsHash: string;
  argsRaw: Record<string, unknown>;
}

/**
 * Detect tool call loops — exact repeats, fuzzy repeats, and cycles.
 */
export class ToolTracker {
  private recentCalls: ToolCallSignature[] = [];
  private toolNameSequence: string[] = [];

  constructor(private config: LoopGuardConfig) {}

  /**
   * Record a tool call and check for loops.
   * Returns a detection result or null if no loop found.
   */
  check(toolName: string, args: Record<string, unknown>): ToolLoopDetection | null {
    const signature = this.makeSignature(toolName, args);

    // Check exact repeat first
    const exact = this.checkExactRepeat(signature);
    if (exact) return exact;

    // Check fuzzy repeat
    const fuzzy = this.checkFuzzyRepeat(signature);
    if (fuzzy) return fuzzy;

    // Check cycle
    const cycle = this.checkCycle(toolName);
    if (cycle) return cycle;

    // No loop detected — record the call
    this.recordCall(signature, toolName);
    return null;
  }

  /** Reset tracking state. */
  reset(): void {
    this.recentCalls = [];
    this.toolNameSequence = [];
  }

  // ── Internal helpers ──

  private makeSignature(toolName: string, args: Record<string, unknown>): ToolCallSignature {
    return {
      toolName,
      argsHash: JSON.stringify(this.sortKeys(args)),
      argsRaw: args,
    };
  }

  private sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const value = obj[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        result[key] = this.sortKeys(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private recordCall(signature: ToolCallSignature, toolName: string): void {
    this.recentCalls.push(signature);
    // Trim to window size
    if (this.recentCalls.length > this.config.toolCallWindow) {
      this.recentCalls = this.recentCalls.slice(-this.config.toolCallWindow);
    }
    this.toolNameSequence.push(toolName);
  }

  private checkExactRepeat(signature: ToolCallSignature): ToolLoopDetection | null {
    const { toolName, argsHash } = signature;
    const window = this.recentCalls.slice(-this.config.toolCallWindow);

    // Count consecutive exact repeats at the end of the window
    let count = 0;
    for (let i = window.length - 1; i >= 0; i--) {
      if (window[i].toolName === toolName && window[i].argsHash === argsHash) {
        count++;
      } else {
        break;
      }
    }

    // count is the number of consecutive matching calls already in the window
    // (not including the current call). Threshold means: if we see
    // threshold consecutive matches, flag it.
    if (count >= this.config.exactRepeatThreshold) {
      return {
        type: "exact",
        toolName,
        consecutiveCount: count,
        details: `Tool "${toolName}" called ${count} times consecutively with identical arguments.`,
      };
    }

    return null;
  }

  private checkFuzzyRepeat(signature: ToolCallSignature): ToolLoopDetection | null {
    const { toolName, argsHash, argsRaw } = signature;
    const window = this.recentCalls.slice(-this.config.toolCallWindow);

    for (let i = window.length - 1; i >= 0; i--) {
      const recent = window[i];
      if (recent.toolName !== toolName) continue;
      if (recent.argsHash === argsHash) continue; // exact match handled above

      const sim = jaccardSimilarity(
        this.argsToTokens(recent.argsRaw),
        this.argsToTokens(argsRaw),
      );

      if (sim >= this.config.fuzzySimilarityThreshold) {
        return {
          type: "fuzzy",
          toolName,
          consecutiveCount: 2,
          details: `Tool "${toolName}" called with similar arguments (similarity: ${sim.toFixed(2)}).`,
        };
      }
    }

    return null;
  }

  /**
   * Serialize args into a whitespace-separated token string for jaccard comparison.
   * Produces: "key1 value1 key2 value2 ..."
   */
  private argsToTokens(args: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(args).sort((a, b) => a[0].localeCompare(b[0]))) {
      parts.push(key, String(value));
    }
    return parts.join(" ");
  }

  private checkCycle(toolName: string): ToolLoopDetection | null {
    // We need at least cycleLength * cycleRepetitions entries to detect a cycle
    const needed = this.config.cycleLength * this.config.cycleRepetitions;
    const sequence = [...this.toolNameSequence, toolName];

    if (sequence.length < needed) return null;

    const tail = sequence.slice(-needed);
    const pattern = tail.slice(0, this.config.cycleLength);

    // Check if the tail forms a repeating pattern
    let isCycle = true;
    for (let rep = 1; rep < this.config.cycleRepetitions; rep++) {
      for (let i = 0; i < this.config.cycleLength; i++) {
        if (tail[rep * this.config.cycleLength + i] !== pattern[i]) {
          isCycle = false;
          break;
        }
      }
      if (!isCycle) break;
    }

    if (isCycle) {
      return {
        type: "cycle",
        toolName,
        consecutiveCount: needed,
        details: `cycle detected: [${pattern.join(" → ")}] repeated ${this.config.cycleRepetitions} times.`,
      };
    }

    return null;
  }
}
