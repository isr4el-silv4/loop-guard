import {
  DEFAULT_CONFIG,
  cloneConfig,
  registerConfigCommand,
  type LoopGuardConfig,
} from "../config";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

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
    expect(DEFAULT_CONFIG.cycleSimilarityThreshold).toBe(0.7);
  });
});

describe("registerConfigCommand", () => {
  it("provides argument completions for subcommands", () => {
    const registered: {
      description?: string;
      getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> | null;
      handler?: unknown;
    } = {};

    const pi = {
      registerCommand: (_name: string, opts: typeof registered) => {
        Object.assign(registered, opts);
      },
    } as unknown as ExtensionAPI;

    registerConfigCommand(pi, DEFAULT_CONFIG);

    expect(registered.getArgumentCompletions).toBeDefined();

    // No prefix → return all subcommands
    const all = registered.getArgumentCompletions!("");
    expect(all).not.toBeNull();
    const values = all!.map((item) => item.value);
    expect(values).toContain("reset");
    expect(values).toContain("config");

    // Prefix filter
    const filtered = registered.getArgumentCompletions!("res");
    expect(filtered).not.toBeNull();
    expect(filtered!.map((item) => item.value)).toContain("reset");
    expect(filtered!.map((item) => item.value)).not.toContain("config");

    // No match → return all
    const noMatch = registered.getArgumentCompletions!("zzz");
    expect(noMatch).not.toBeNull();
    expect(noMatch!.map((item) => item.value)).toContain("reset");
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
