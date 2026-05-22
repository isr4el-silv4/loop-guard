import {
  DEFAULT_CONFIG,
  cloneConfig,
  type LoopGuardConfig,
} from "../config";

describe("DEFAULT_CONFIG", () => {
  it("has correct default values", () => {
    expect(DEFAULT_CONFIG.toolCallWindow).toBe(5);
    expect(DEFAULT_CONFIG.exactRepeatThreshold).toBe(2);
    expect(DEFAULT_CONFIG.fuzzySimilarityThreshold).toBe(0.85);
    expect(DEFAULT_CONFIG.cycleLength).toBe(2);
    expect(DEFAULT_CONFIG.cycleRepetitions).toBe(2);
    expect(DEFAULT_CONFIG.thinkingWindow).toBe(3);
    expect(DEFAULT_CONFIG.thinkingSimilarityThreshold).toBe(0.8);
    expect(DEFAULT_CONFIG.thinkingMinLength).toBe(100);
    expect(DEFAULT_CONFIG.resultStagnationThreshold).toBe(3);
    expect(DEFAULT_CONFIG.hintAfter).toBe(1);
    expect(DEFAULT_CONFIG.blockAfter).toBe(2);
    expect(DEFAULT_CONFIG.blockBeforeTerminate).toBe(3);
    expect(DEFAULT_CONFIG.maxTurns).toBeNull();
  });
});

describe("cloneConfig", () => {
  it("produces a deep copy", () => {
    const clone = cloneConfig(DEFAULT_CONFIG);
    expect(clone).not.toBe(DEFAULT_CONFIG);
    expect(clone).toEqual(DEFAULT_CONFIG);
  });

  it("modifications to clone do not affect original", () => {
    const clone = cloneConfig(DEFAULT_CONFIG);
    clone.toolCallWindow = 99;
    expect(DEFAULT_CONFIG.toolCallWindow).toBe(5);
    expect(clone.toolCallWindow).toBe(99);
  });

  it("preserves custom values", () => {
    const custom: LoopGuardConfig = {
      ...DEFAULT_CONFIG,
      toolCallWindow: 10,
      maxTurns: 50,
    };
    const clone = cloneConfig(custom);
    expect(clone.toolCallWindow).toBe(10);
    expect(clone.maxTurns).toBe(50);
  });
});
