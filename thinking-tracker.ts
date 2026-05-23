import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LoopGuardConfig } from "./config";
import { ngramSimilarity } from "./similarity";

/**
 * Describes a detected thinking loop (legacy interface, kept for compatibility).
 */
export interface ThinkingLoopDetection {
  type: "repetitive";
  consecutiveCount: number;
  details: string;
}

/**
 * Streaming loop detection with multi-turn escalation.
 *
 * Detects repetitive thinking blocks in real-time during streaming and uses
 * a two-stage escalation: warn on first detection, abort on second detection
 * within the same prompt.
 */
export class ThinkingTracker {
  // ── Per-message state (reset on each assistant message) ──
  private buffer = "";
  private lines: string[] = [];
  private consecutiveCount = 0;
  private lastLine = "";
  private loopDetectedThisTurn = false;

  // ── Per-prompt state (reset only on agent_start) ──
  private promptLoopCount = 0;
  private hasAborted = false;

  // ── Incremental frequency map for mode-based density ──
  private frequencyMap: Map<number, number> = new Map();
  private lineGroupId: number = 0;
  private groupIds: number[] = [];

  constructor(private config: LoopGuardConfig) {}

  // ── Public API ──

  /**
   * Full reset — called on `agent_start` (new prompt).
   * Clears ALL state including promptLoopCount and hasAborted.
   */
  reset(): void {
    this.buffer = "";
    this.lines = [];
    this.consecutiveCount = 0;
    this.lastLine = "";
    this.loopDetectedThisTurn = false;
    this.promptLoopCount = 0;
    this.hasAborted = false;
    this.frequencyMap = new Map();
    this.lineGroupId = 0;
    this.groupIds = [];
  }

  /**
   * Reset per-message state — called on `message_start` (assistant).
   * Preserves promptLoopCount and hasAborted.
   */
  resetMessage(): void {
    this.buffer = "";
    this.lines = [];
    this.consecutiveCount = 0;
    this.lastLine = "";
    this.loopDetectedThisTurn = false;
    this.frequencyMap = new Map();
    this.lineGroupId = 0;
    this.groupIds = [];
  }

  /**
   * Called on each `thinking_delta` event.
   * Accumulates chunk, drains complete lines, runs detection.
   */
  onChunk(delta: string, ctx: ExtensionContext): void {
    if (this.hasAborted) return;

    // Append to buffer
    this.buffer += delta;

    // Safety cap: if buffer exceeds maxBufferSize, force-process
    if (this.buffer.length > (this.config.maxBufferSize ?? 10240)) {
      if (this.buffer.trim()) {
        this.processLine(this.buffer.trim(), ctx);
      }
      this.buffer = "";
      this.flushFrequencyMap();
      return;
    }

    // Drain complete lines
    while (this.buffer.includes("\n")) {
      const newlineIdx = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (line) {
        this.processLine(line, ctx);
      }

      if (this.hasAborted) break;
    }
  }

  /**
   * Called on `thinking_end`.
   * Flushes remaining buffer content.
   */
  onThinkingEnd(_ctx: ExtensionContext): void {
    if (this.hasAborted) return;
    if (this.buffer.trim()) {
      this.processLine(this.buffer.trim(), _ctx);
      this.buffer = "";
    }
  }

  // ── Detection Logic ──

  /**
   * Process a single line: consecutive check, sliding window, density check.
   */
  private processLine(line: string, ctx: ExtensionContext): void {
    // Phase 2a: Consecutive Check
    if (this.isSimilar(line, this.lastLine)) {
      this.consecutiveCount++;
    } else {
      this.consecutiveCount = 1;
    }
    this.lastLine = line;

    // Phase 2b: Sliding Window
    this.lines.push(line);
    const densityWindow = this.config.densityWindow ?? 100;
    if (this.lines.length > densityWindow) {
      this.lines.shift();
    }

    // Update incremental frequency map
    this.assignGroupId(line);

    // Phase 2c: Density Check (mode-based)
    const density = this.computeDensity();

    // Phase 2d: Threshold Evaluation
    const consecutiveTriggered =
      this.consecutiveCount >= (this.config.consecutiveThreshold ?? 4);
    const densityTriggered =
      this.lines.length >= 5 && density >= (this.config.densityThreshold ?? 0.75);

    if (consecutiveTriggered || densityTriggered) {
      this.onLoopDetected(ctx);
    }
  }

  /**
   * Assign a group ID to a line based on similarity to existing groups.
   */
  private assignGroupId(line: string): void {
    // Find an existing group this line is similar to
    let foundGroupId: number | null = null;

    // Check against group representatives
    for (const [groupId, _count] of this.frequencyMap) {
      // Get a representative line for this group
      const repIdx = this.groupIds.indexOf(groupId);
      if (repIdx !== -1 && this.isSimilar(line, this.lines[repIdx])) {
        foundGroupId = groupId;
        break;
      }
    }

    if (foundGroupId !== null) {
      // Increment existing group
      this.frequencyMap.set(foundGroupId, (this.frequencyMap.get(foundGroupId) ?? 0) + 1);
      this.groupIds.push(foundGroupId);
    } else {
      // Create new group
      const newId = this.lineGroupId++;
      this.frequencyMap.set(newId, 1);
      this.groupIds.push(newId);
    }

    // Trim groupIds to match lines window
    const densityWindow = this.config.densityWindow ?? 100;
    while (this.groupIds.length > densityWindow) {
      const removedId = this.groupIds.shift()!;
      const count = this.frequencyMap.get(removedId) ?? 1;
      if (count <= 1) {
        this.frequencyMap.delete(removedId);
      } else {
        this.frequencyMap.set(removedId, count - 1);
      }
    }
  }

  /**
   * Compute density: mode group size / window size.
   */
  private computeDensity(): number {
    if (this.lines.length === 0) return 0;

    let maxSize = 0;
    for (const count of this.frequencyMap.values()) {
      if (count > maxSize) maxSize = count;
    }

    return maxSize / this.lines.length;
  }

  /**
   * Flush the frequency map (used after buffer cap force-process).
   */
  private flushFrequencyMap(): void {
    this.frequencyMap = new Map();
    this.lineGroupId = 0;
    this.groupIds = [];
  }

  /**
   * Similarity check: exact match first, then n-gram fallback.
   */
  private isSimilar(lineA: string, lineB: string): boolean {
    if (lineA === lineB) return true;
    return ngramSimilarity(lineA, lineB) >= (this.config.lineSimilarityThreshold ?? 0.85);
  }

  /**
   * Escalation: warn on first detection, abort on second.
   */
  private onLoopDetected(ctx: ExtensionContext): void {
    if (this.loopDetectedThisTurn) return;
    this.loopDetectedThisTurn = true;
    this.promptLoopCount++;

    const escalationTurns = this.config.escalationTurns ?? 2;

    if (this.promptLoopCount >= escalationTurns) {
      this.hasAborted = true;
      ctx.ui.notify(
        `Persistent loop detected (${this.promptLoopCount}/${escalationTurns}), aborting`,
        "error",
      );
      ctx.abort();
    } else {
      ctx.ui.notify(
        `Repetitive thinking detected (${this.promptLoopCount}/${escalationTurns})`,
        "warning",
      );
    }
  }

  // ── Legacy API (kept for backward compatibility) ──

  /**
   * Record a thought and check for repetitive patterns.
   * Returns a detection result or null if no loop found.
   * @deprecated Use streaming API (onChunk/onThinkingEnd) instead.
   */
  check(thought: string): ThinkingLoopDetection | null {
    const normalized = thought.trim().replace(/\s+/g, " ").slice(0, 2000);

    if (normalized.length < (this.config.thinkingMinLength ?? 100)) {
      return null;
    }

    const window = this.recentThoughts.slice(-(this.config.thinkingWindow ?? 3));

    let count = 0;
    let lastSimilarity = 0;

    for (let i = window.length - 1; i >= 0; i--) {
      const sim = ngramSimilarity(window[i], normalized, 2);
      if (sim >= (this.config.thinkingSimilarityThreshold ?? 0.8)) {
        count++;
        lastSimilarity = sim;
      } else {
        break;
      }
    }

    if (count >= 1) {
      this.recentThoughts.push(normalized);
      if (this.recentThoughts.length > (this.config.thinkingWindow ?? 3)) {
        this.recentThoughts = this.recentThoughts.slice(-(this.config.thinkingWindow ?? 3));
      }
      return {
        type: "repetitive",
        consecutiveCount: count,
        details: `repetitive thinking detected: ${count} similar thoughts in sequence (similarity: ${lastSimilarity.toFixed(2)}).`,
      };
    }

    this.recentThoughts.push(normalized);
    if (this.recentThoughts.length > (this.config.thinkingWindow ?? 3)) {
      this.recentThoughts = this.recentThoughts.slice(-(this.config.thinkingWindow ?? 3));
    }
    return null;
  }

  private recentThoughts: string[] = [];
}
