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
  private toolNameSequence: ToolCallSignature[] = [];

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
    const cycle = this.checkCycle(signature);
    if (cycle) return cycle;

    // No loop detected — record the call
    this.recordCall(signature);
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

  private recordCall(signature: ToolCallSignature): void {
    this.recentCalls.push(signature);
    // Trim to window size
    if (this.recentCalls.length > this.config.toolCallWindow) {
      this.recentCalls = this.recentCalls.slice(-this.config.toolCallWindow);
    }
    this.toolNameSequence.push(signature);
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

  private checkCycle(signature: ToolCallSignature): ToolLoopDetection | null {
    const needed = this.config.cycleLength * this.config.cycleRepetitions;
    const sequence = [...this.toolNameSequence, signature];

    if (sequence.length < needed) return null;

    const tail = sequence.slice(-needed);
    const nameTail = tail.map((s) => s.toolName);
    const namePattern = nameTail.slice(0, this.config.cycleLength);

    // Phase 1: Shape detection (tool names only)
    let isCycle = true;
    for (let rep = 1; rep < this.config.cycleRepetitions; rep++) {
      for (let i = 0; i < this.config.cycleLength; i++) {
        if (nameTail[rep * this.config.cycleLength + i] !== namePattern[i]) {
          isCycle = false;
          break;
        }
      }
      if (!isCycle) break;
    }

    if (!isCycle) return null;

    // Phase 2: Argument confirmation (skip if threshold is 0)
    if (this.config.cycleSimilarityThreshold > 0) {
      for (let pos = 0; pos < this.config.cycleLength; pos++) {
        for (let rep = 1; rep < this.config.cycleRepetitions; rep++) {
          const baseSig = tail[pos];
          const repSig = tail[rep * this.config.cycleLength + pos];

          const sim = jaccardSimilarity(
            this.argsToTokens(baseSig.argsRaw),
            this.argsToTokens(repSig.argsRaw),
          );

          if (sim < this.config.cycleSimilarityThreshold) {
            return null; // Args differ — agent is exploring, not looping
          }
        }
      }
    }

    // Confirmed cycle
    return {
      type: "cycle",
      toolName: signature.toolName,
      consecutiveCount: needed,
      details: `cycle detected: [${namePattern.join(" → ")}] repeated ${this.config.cycleRepetitions} times with similar arguments.`,
    };
  }
}
