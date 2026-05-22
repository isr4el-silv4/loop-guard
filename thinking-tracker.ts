import type { LoopGuardConfig } from "./config";
import { ngramSimilarity } from "./similarity";

/**
 * Describes a detected thinking loop.
 */
export interface ThinkingLoopDetection {
  type: "repetitive";
  consecutiveCount: number;
  details: string;
}

/**
 * Detect repetitive thinking patterns using n-gram similarity.
 */
export class ThinkingTracker {
  private recentThoughts: string[] = [];

  constructor(private config: LoopGuardConfig) {}

  /**
   * Record a thought and check for repetitive patterns.
   * Returns a detection result or null if no loop found.
   */
  check(thought: string): ThinkingLoopDetection | null {
    // Normalize: trim, collapse whitespace, cap at 2000 chars
    const normalized = thought.trim().replace(/\s+/g, " ").slice(0, 2000);

    // Skip short thoughts
    if (normalized.length < this.config.thinkingMinLength) {
      return null;
    }

    const window = this.recentThoughts.slice(-this.config.thinkingWindow);

    // Count consecutive similar thoughts from the end of the window
    let count = 0;
    let lastSimilarity = 0;

    for (let i = window.length - 1; i >= 0; i--) {
      const sim = ngramSimilarity(window[i], normalized, 2);
      if (sim >= this.config.thinkingSimilarityThreshold) {
        count++;
        lastSimilarity = sim;
      } else {
        break;
      }
    }

    if (count >= 1) {
      // Record this thought before returning detection
      this.recentThoughts.push(normalized);
      if (this.recentThoughts.length > this.config.thinkingWindow) {
        this.recentThoughts = this.recentThoughts.slice(-this.config.thinkingWindow);
      }
      return {
        type: "repetitive",
        consecutiveCount: count,
        details: `repetitive thinking detected: ${count} similar thoughts in sequence (similarity: ${lastSimilarity.toFixed(2)}).`,
      };
    }

    // No loop detected — record the thought
    this.recentThoughts.push(normalized);
    if (this.recentThoughts.length > this.config.thinkingWindow) {
      this.recentThoughts = this.recentThoughts.slice(-this.config.thinkingWindow);
    }
    return null;
  }

  /** Reset tracking state. */
  reset(): void {
    this.recentThoughts = [];
  }
}
