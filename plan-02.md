# plan-02: Hybrid Cycle Detection — Tool Names + Argument Confirmation

## Problem

The current `checkCycle()` in `tool-tracker.ts` detects cycles **based on tool names alone**. This produces false positives for legitimate investigation patterns:

```
grep("auth") → read("login.ts") → grep("session") → read("token.ts")
```

The agent is exploring different targets, not stuck in a loop — but name-only detection flags it as `[grep → read]` repeated 2×.

## Solution

**Option C (Hybrid):** Use tool-name cycles as a *signal*, then require argument similarity as *confirmation*. Only flag when **both** conditions are met.

### Behavior Matrix

| Scenario | Cycle Shape | Args Similar | Result |
|----------|-------------|-------------|--------|
| `grep("foo") → read("a.ts") → grep("foo") → read("a.ts")` | ✅ | ✅ | 🚩 **Flagged** |
| `grep("auth") → read("login.ts") → grep("session") → read("token.ts")` | ✅ | ❌ | ✅ **Not flagged** (legitimate exploration) |
| `grep("bug") → read("src.ts") → grep("fix") → find("*.ts")` | ❌ | — | ✅ **Not flagged** (different pattern) |

---

## Changes

### 1. `config.ts` — New Config Field

Add `cycleSimilarityThreshold` to `LoopGuardConfig`:

```typescript
export interface LoopGuardConfig {
  // ... existing fields ...

  // ── Cycle Detection ──
  cycleLength: number;
  cycleRepetitions: number;
  cycleSimilarityThreshold: number;  // NEW: Jaccard similarity threshold for argument confirmation (0.0–1.0)
}
```

Default value:

```typescript
export const DEFAULT_CONFIG: LoopGuardConfig = {
  // ... existing defaults ...
  cycleSimilarityThreshold: 0.7,  // Slightly lower than fuzzy (0.85) since we're comparing across positions, not consecutive calls
};
```

Add to `FIELD_DESCRIPTIONS`:

```typescript
cycleSimilarityThreshold: "Jaccard similarity threshold for cycle argument confirmation (0.0–1.0, set to 0 to disable)",
```

**Special case:** If `cycleSimilarityThreshold` is `0`, skip argument confirmation entirely (restore current name-only behavior). This gives users a knob to toggle the hybrid check.

---

### 2. `tool-tracker.ts` — Store Signatures in Sequence, Confirm with Args

#### 2a. Change `toolNameSequence` to store full signatures

Current:

```typescript
private toolNameSequence: string[] = [];  // Only tool names
```

Change to:

```typescript
private toolNameSequence: ToolCallSignature[] = [];  // Full signatures for arg comparison
```

This means `recordCall()` writes to one place instead of two:

```typescript
private recordCall(signature: ToolCallSignature): void {
  this.recentCalls.push(signature);
  if (this.recentCalls.length > this.config.toolCallWindow) {
    this.recentCalls = this.recentCalls.slice(-this.config.toolCallWindow);
  }
  this.toolNameSequence.push(signature);
}
```

Remove the `toolName` parameter from `recordCall()` since it's already in the signature.

#### 2b. Update `checkCycle()` to accept the full signature

Current signature:

```typescript
private checkCycle(toolName: string): ToolLoopDetection | null
```

Change to:

```typescript
private checkCycle(signature: ToolCallSignature): ToolLoopDetection | null
```

Build the sequence including the current call:

```typescript
const sequence = [...this.toolNameSequence, signature];
```

Extract names for shape detection:

```typescript
const nameSequence = sequence.map(s => s.toolName);
```

#### 2c. Two-Phase Detection

**Phase 1 — Shape Detection (unchanged):**

Check if the tail of the name sequence forms a repeating pattern. If not, return `null` early.

**Phase 2 — Argument Confirmation (new):**

If a cycle shape is found, verify that the arguments at corresponding cycle positions are similar.

For each repetition of the cycle, compare the args at the same position within each repetition:

```
Cycle length = 2, repetitions = 2
Tail: [sig_A1, sig_B1, sig_A2, sig_B2]
      └─rep 1──┘└─rep 2──┘

Compare: sig_A1.args vs sig_A2.args  (position 0 across repetitions)
Compare: sig_B1.args vs sig_B2.args  (position 1 across repetitions)
```

For each position `i` in the pattern, collect all signatures at that position across repetitions:

```typescript
// For position i in the pattern, gather all signatures at that position
const positionSignatures: ToolCallSignature[][] = [];
for (let i = 0; i < cycleLength; i++) {
  const group: ToolCallSignature[] = [];
  for (let rep = 0; rep < cycleRepetitions; rep++) {
    group.push(tail[rep * cycleLength + i]);
  }
  positionSignatures.push(group);
}
```

Then for each position group, check that all signatures are similar to each other (pairwise Jaccard):

```typescript
for (const group of positionSignatures) {
  // All signatures in the group must be pairwise-similar
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const sim = jaccardSimilarity(
        this.argsToTokens(group[i].argsRaw),
        this.argsToTokens(group[j].argsRaw)
      );
      if (sim < this.config.cycleSimilarityThreshold) {
        return null;  // Args at this position differ — not a true loop
      }
    }
  }
}
```

If all positions pass, the cycle is confirmed. Return the detection.

#### 2d. Updated `checkCycle()` Pseudocode

```typescript
private checkCycle(signature: ToolCallSignature): ToolLoopDetection | null {
  const needed = this.config.cycleLength * this.config.cycleRepetitions;
  const sequence = [...this.toolNameSequence, signature];

  if (sequence.length < needed) return null;

  const tail = sequence.slice(-needed);
  const nameTail = tail.map(s => s.toolName);
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
          this.argsToTokens(repSig.argsRaw)
        );

        if (sim < this.config.cycleSimilarityThreshold) {
          return null;  // Args differ — agent is exploring, not looping
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
```

---

### 3. `test/` — New Tests

#### 3a. Cycle with identical args → flagged

```typescript
it("detects cycle when tool names and arguments repeat", () => {
  const tracker = new ToolTracker({
    ...DEFAULT_CONFIG,
    cycleSimilarityThreshold: 0.7,
  });

  tracker.check("grep", { pattern: "foo", path: "./src" });
  tracker.check("read", { path: "auth.ts" });
  tracker.check("grep", { pattern: "foo", path: "./src" });
  const detection = tracker.check("read", { path: "auth.ts" });

  expect(detection).not.toBeNull();
  expect(detection?.type).toBe("cycle");
});
```

#### 3b. Cycle with different args → not flagged

```typescript
it("does not flag cycle when arguments differ across repetitions", () => {
  const tracker = new ToolTracker({
    ...DEFAULT_CONFIG,
    cycleSimilarityThreshold: 0.7,
  });

  tracker.check("grep", { pattern: "auth", path: "./src" });
  tracker.check("read", { path: "login.ts" });
  tracker.check("grep", { pattern: "session", path: "./lib" });
  const detection = tracker.check("read", { path: "token.ts" });

  expect(detection).toBeNull();  // Args differ — legitimate exploration
});
```

#### 3c. Cycle with threshold 0 → name-only behavior restored

```typescript
it("falls back to name-only detection when cycleSimilarityThreshold is 0", () => {
  const tracker = new ToolTracker({
    ...DEFAULT_CONFIG,
    cycleSimilarityThreshold: 0,
  });

  tracker.check("grep", { pattern: "auth", path: "./src" });
  tracker.check("read", { path: "login.ts" });
  tracker.check("grep", { pattern: "session", path: "./lib" });
  const detection = tracker.check("read", { path: "token.ts" });

  expect(detection).not.toBeNull();  // Name-only, so cycle is flagged
  expect(detection?.type).toBe("cycle");
});
```

#### 3d. Cycle with similar (but not identical) args → flagged

```typescript
it("flags cycle when arguments are similar above threshold", () => {
  const tracker = new ToolTracker({
    ...DEFAULT_CONFIG,
    cycleSimilarityThreshold: 0.7,
  });

  // Args differ slightly (offset 1 vs 50) but share most tokens
  tracker.check("read", { path: "tool.ts", offset: 1, limit: 100 });
  tracker.check("grep", { pattern: "bug", path: "./src", context: 3 });
  tracker.check("read", { path: "tool.ts", offset: 50, limit: 100 });
  const detection = tracker.check("grep", { pattern: "bug", path: "./src", context: 5 });

  expect(detection).not.toBeNull();
  expect(detection?.type).toBe("cycle");
});
```

#### 3e. Cycle with 3+ repetitions

```typescript
it("detects longer cycles with multiple repetitions", () => {
  const config: LoopGuardConfig = {
    ...DEFAULT_CONFIG,
    cycleLength: 3,
    cycleRepetitions: 2,
    cycleSimilarityThreshold: 0.7,
  };
  const tracker = new ToolTracker(config);

  // Pattern: grep → read → edit
  tracker.check("grep", { pattern: "foo" });
  tracker.check("read", { path: "a.ts" });
  tracker.check("edit", { path: "a.ts" });
  tracker.check("grep", { pattern: "foo" });
  tracker.check("read", { path: "a.ts" });
  const detection = tracker.check("edit", { path: "a.ts" });

  expect(detection).not.toBeNull();
  expect(detection?.type).toBe("cycle");
});
```

---

## Files to Modify

| File | Change |
|------|--------|
| `config.ts` | Add `cycleSimilarityThreshold` to interface, defaults, and field descriptions |
| `tool-tracker.ts` | Change `toolNameSequence` type, update `checkCycle()` with two-phase detection, update `recordCall()` |
| `test/config.test.ts` | Add test for new config field parsing |
| `test/tool-tracker.test.ts` | Add tests 3a–3e above |

## Files NOT to Modify

| File | Reason |
|------|--------|
| `index.ts` | No changes — cycle detection is internal to ToolTracker |
| `escalation.ts` | No changes — detection interface unchanged |
| `thinking-tracker.ts` | No changes — only tool call cycles affected |
| `result-tracker.ts` | No changes — only tool call cycles affected |
| `similarity.ts` | No changes — reuse existing `jaccardSimilarity` |

## Backward Compatibility

- `cycleSimilarityThreshold: 0` restores the original name-only behavior
- Existing exact-repeat and fuzzy-repeat detection are untouched
- The `ToolLoopDetection` interface and `details` string format remain the same (only the message text changes slightly)
