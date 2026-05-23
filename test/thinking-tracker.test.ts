import { ThinkingTracker } from "../thinking-tracker";
import { DEFAULT_CONFIG, type LoopGuardConfig } from "../config";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── Helpers ──

function makeCtx(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    ui: {
      notify: jest.fn(),
      select: jest.fn().mockResolvedValue(null),
      input: jest.fn().mockResolvedValue(null),
    },
    abort: jest.fn(),
    ...overrides,
  };
}

const baseConfig: LoopGuardConfig = {
  ...DEFAULT_CONFIG,
  consecutiveThreshold: 4,
  densityThreshold: 0.75,
  densityWindow: 100,
  lineSimilarityThreshold: 0.85,
  maxBufferSize: 10240,
  escalationTurns: 2,
};

// ── Tests ──

describe("ThinkingTracker", () => {
  let tracker: ThinkingTracker;
  let ctx: ExtensionContext;

  beforeEach(() => {
    tracker = new ThinkingTracker(baseConfig);
    ctx = makeCtx();
  });

  // ── Test 1: Consecutive repetition triggers warning on first detection ──

  it("Test 1: consecutive repetition triggers warning on first detection (escalation step 1)", () => {
    tracker.reset();
    tracker.resetMessage();

    const line = "I will output the tool result.\n";
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
    expect(ctx.abort).not.toHaveBeenCalled();
  });

  // ── Test 2: Consecutive repetition triggers abort on second detection ──

  it("Test 2: consecutive repetition triggers abort on second detection (escalation step 2)", () => {
    tracker.reset();

    // Turn 1: first detection → warning
    tracker.resetMessage();
    const line = "I will output the tool result.\n";
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
    expect(ctx.abort).not.toHaveBeenCalled();

    // Turn 2: second detection → abort
    tracker.resetMessage();
    jest.clearAllMocks();
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Persistent loop detected (2/2), aborting",
      "error",
    );
    expect(ctx.abort).toHaveBeenCalled();
  });

  // ── Test 3: reset() clears promptLoopCount ──

  it("Test 3: reset() clears promptLoopCount (new prompt resets counter)", () => {
    tracker.reset();
    tracker.resetMessage();

    const line = "I will output the tool result.\n";
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }

    // Simulate new prompt
    tracker.reset();
    jest.clearAllMocks();

    // Same pattern again should only warn (not abort)
    tracker.resetMessage();
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
    expect(ctx.abort).not.toHaveBeenCalled();
  });

  // ── Test 4: resetMessage() preserves promptLoopCount ──

  it("Test 4: resetMessage() preserves promptLoopCount (cross-turn persistence)", () => {
    tracker.reset();

    // Turn 1: first detection
    tracker.resetMessage();
    const line = "I will output the tool result.\n";
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );

    // Turn 2: resetMessage preserves promptLoopCount, same pattern → abort
    tracker.resetMessage();
    jest.clearAllMocks();
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Persistent loop detected (2/2), aborting",
      "error",
    );
    expect(ctx.abort).toHaveBeenCalled();
  });

  // ── Test 5: Fragmented chunks reconstruct correct lines ──

  it("Test 5: fragmented chunks reconstruct correct lines across boundaries", () => {
    tracker.reset();
    tracker.resetMessage();

    // Send fragments that together form identical lines
    tracker.onChunk("I will output ", ctx);
    tracker.onChunk("the tool result.", ctx);
    tracker.onChunk("\nI will output ", ctx);
    tracker.onChunk("the tool result.", ctx);
    tracker.onChunk("\nI will output ", ctx);
    tracker.onChunk("the tool result.", ctx);
    tracker.onChunk("\nI will output ", ctx);
    tracker.onChunk("the tool result.\n", ctx);

    // 4 identical lines reconstructed → detection
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
  });

  // ── Test 6: onThinkingEnd() flushes remaining buffer ──

  it("Test 6: onThinkingEnd() flushes remaining buffer (last line without trailing newline)", () => {
    tracker.reset();
    tracker.resetMessage();

    tracker.onChunk("I will output the tool result.\n", ctx);
    tracker.onChunk("I will output the tool result.\n", ctx);
    tracker.onChunk("I will output the tool result.\n", ctx);
    tracker.onChunk("I will output the tool result.", ctx); // no \n, stays in buffer

    (ctx.ui.notify as jest.Mock).mockClear();

    // Flush the buffer → 4th line processed → triggers
    tracker.onThinkingEnd(ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
  });

  // ── Test 7: Buffer cap force-processes oversized lines ──

  it("Test 7: buffer cap force-processes oversized lines (10KB safety cap)", () => {
    const config = { ...baseConfig, maxBufferSize: 50, consecutiveThreshold: 2 };
    tracker = new ThinkingTracker(config);
    tracker.reset();
    tracker.resetMessage();

    const bigChunk = "A".repeat(60);
    tracker.onChunk(bigChunk, ctx);

    tracker.onChunk("A".repeat(60), ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
  });

  // ── Test 8: Diverse content never triggers ──

  it("Test 8: diverse content never triggers (false positive safety)", () => {
    tracker.reset();
    tracker.resetMessage();

    const diverseLines = [
      "First I need to understand the problem statement clearly.\n",
      "The code appears to have a bug in the parsing function.\n",
      "Let me check the test file to see what the expected output should be.\n",
      "The error message indicates a null pointer exception.\n",
      "I should add a guard clause to handle the empty input case.\n",
      "Now I will modify the function to return early on empty input.\n",
      "After the fix, I need to run the tests to verify it works.\n",
      "The test suite should pass with the new guard clause in place.\n",
      "Let me also check for similar issues in other functions.\n",
      "The refactoring looks complete, time to commit the changes.\n",
    ];

    for (const line of diverseLines) {
      tracker.onChunk(line, ctx);
    }

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(ctx.abort).not.toHaveBeenCalled();
  });

  // ── Test 9: Density-based detection with mode calculation ──

  it("Test 9: density-based detection with mode calculation", () => {
    const config = {
      ...baseConfig,
      densityWindow: 20,
      densityThreshold: 0.75,
      consecutiveThreshold: 100,
    };
    tracker = new ThinkingTracker(config);
    tracker.reset();
    tracker.resetMessage();

    const modeLine = "I will output the tool result.\n";
    for (let i = 0; i < 16; i++) {
      tracker.onChunk(modeLine, ctx);
    }
    tracker.onChunk("Unique line one that is different from the rest.\n", ctx);
    tracker.onChunk("Another unique line for variety in the window.\n", ctx);
    tracker.onChunk("Yet another different line to lower the density.\n", ctx);
    tracker.onChunk("Final unique line to bring density below threshold.\n", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
  });

  // ── Test 10: Near-identical lines trigger via n-gram fallback ──

  it("Test 10: near-identical lines trigger via n-gram similarity fallback", () => {
    const config = {
      ...baseConfig,
      lineSimilarityThreshold: 0.85,
      consecutiveThreshold: 4,
    };
    tracker = new ThinkingTracker(config);
    tracker.reset();
    tracker.resetMessage();

    // Each line differs slightly from the previous, but n-gram similarity > 0.85
    // so consecutiveCount keeps incrementing via isSimilar (n-gram fallback)
    const lineA = "I will now output the tool result and continue processing the data carefully and thoroughly to ensure correctness.";
    const lineB = "I will now output the tool result and continue processing the data carefully and completely to ensure correctness.";
    const lineC = "I will now output the tool result and continue processing the data carefully and properly to ensure correctness.";
    const lineD = "I will now output the tool result and continue processing the data carefully and correctly to ensure correctness.";

    tracker.onChunk(lineA + "\n", ctx);
    tracker.onChunk(lineB + "\n", ctx);
    tracker.onChunk(lineC + "\n", ctx);
    tracker.onChunk(lineD + "\n", ctx);

    // Should detect via consecutive similar lines (n-gram similarity above 0.85)
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
  });

  // ── Test 11: loopDetectedThisTurn prevents double-counting ──

  it("Test 11: loopDetectedThisTurn prevents double-counting within same thinking block", () => {
    tracker.reset();
    tracker.resetMessage();

    const line = "I will output the tool result.\n";
    for (let i = 0; i < 10; i++) {
      tracker.onChunk(line, ctx);
    }

    expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );
  });

  // ── Test 12: No processing after hasAborted ──

  it("Test 12: no processing after hasAborted (post-abort guard)", () => {
    tracker.reset();

    // Turn 1: first detection → warning
    tracker.resetMessage();
    const line = "I will output the tool result.\n";
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Repetitive thinking detected (1/2)",
      "warning",
    );

    // Turn 2: second detection → abort
    tracker.resetMessage();
    (ctx.ui.notify as jest.Mock).mockClear();
    for (let i = 0; i < 4; i++) {
      tracker.onChunk(line, ctx);
    }
    expect(ctx.abort).toHaveBeenCalled();

    // Further chunks should be no-ops
    (ctx.ui.notify as jest.Mock).mockClear();
    (ctx.abort as jest.Mock).mockClear();
    for (let i = 0; i < 10; i++) {
      tracker.onChunk("anything at all\n", ctx);
    }
    tracker.onThinkingEnd(ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
    expect(ctx.abort).not.toHaveBeenCalled();
  });
});
