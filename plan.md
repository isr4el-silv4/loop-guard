# LoopGuard — Implementation Plan

> Pi extension that detects and prevents LLM loops in both tool calls and thinking/reasoning, with progressive escalation.

## Directory Structure

```
~/.pi/agent/extensions/loop-guard/
├── package.json
├── index.ts              # Extension entry point — wires all modules + event handlers
├── config.ts             # Config interface, defaults, persistence, /loop-guard config command
├── similarity.ts         # Zero-dependency: Jaccard (token) + N-gram (char) similarity
├── tool-tracker.ts       # Tool call loop detection: exact, fuzzy, cycle
├── thinking-tracker.ts   # Thinking/reasoning loop detection via message_end
├── result-tracker.ts     # Result stagnation detection
├── escalation.ts         # Escalation state machine + system prompt hint generation
└── plan.md               # This file
```

---

## Module-by-Module Implementation

### 1. `package.json`

Minimal package.json identifying the extension. No runtime dependencies (zero-dependency approach).

```json
{
  "name": "loop-guard",
  "version": "0.1.0",
  "description": "Pi extension that detects and prevents LLM loops in tool calls and reasoning",
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

---

### 2. `similarity.ts`

**Purpose**: Zero-dependency text similarity functions.

**Exports**:

```typescript
/**
 * Jaccard similarity at token level (split by whitespace).
 * Returns 0.0 (no overlap) to 1.0 (identical token sets).
 * Used for comparing serialized tool arguments.
 */
export function jaccardSimilarity(a: string, b: string): number;

/**
 * N-gram similarity at character level (default n=2).
 * Returns 0.0 (no overlap) to 1.0 (identical n-gram sets).
 * Used for comparing thinking/reasoning text blocks.
 */
export function ngramSimilarity(a: string, b: string, n?: number): number;
```

**Details**:
- `jaccardSimilarity`: Lowercase → split by `/\s+/` → Set intersection / Set union
- `ngramSimilarity`: Lowercase → normalize whitespace → sliding window of size N → Set intersection / Set union
- Both handle empty-string edge cases (return 1.0 if both empty)

---

### 3. `config.ts`

**Purpose**: Configuration interface, defaults, and the `/loop-guard config` command.

**Config Interface**:

```typescript
export interface LoopGuardConfig {
  // ── Tool Call Detection ──
  toolCallWindow: number;            // Sliding window size           (default: 5)
  exactRepeatThreshold: number;      // Consecutive exact repeats     (default: 2)
  fuzzySimilarityThreshold: number;  // Jaccard threshold 0.0-1.0     (default: 0.85)

  // ── Cycle Detection ──
  cycleLength: number;               // Pattern length to detect      (default: 2)
  cycleRepetitions: number;          // Times pattern must repeat     (default: 2)

  // ── Thinking Loop Detection ──
  thinkingWindow: number;            // Recent thinking blocks        (default: 3)
  thinkingSimilarityThreshold: number; // N-gram threshold 0.0-1.0    (default: 0.80)
  thinkingMinLength: number;         // Skip if shorter than this     (default: 100)

  // ── Result Stagnation ──
  resultStagnationThreshold: number; // Same result N times           (default: 3)

  // ── Escalation ──
  hintAfter: number;                 // Detections before hint        (default: 1)
  blockAfter: number;                // Detections before blocking    (default: 2)
  blockBeforeTerminate: number;      // Blocks before termination     (default: 3)

  // ── Safety Net ──
  maxTurns: number | null;           // Hard turn limit               (default: null)
}
```

**Exports**:

```typescript
export const DEFAULT_CONFIG: LoopGuardConfig;
export function cloneConfig(config: LoopGuardConfig): LoopGuardConfig;
export function registerConfigCommand(pi: ExtensionAPI, config: LoopGuardConfig): void;
```

**`/loop-guard config` command** (`registerConfigCommand`):

- Uses `ctx.ui.select()` or `ctx.ui.input()` to let the user pick which field to edit
- Shows current value alongside description
- Accepts new value via `ctx.ui.input()`
- Updates the config object in place (mutable reference shared with trackers)
- Confirms change with `ctx.ui.notify()`

**Config field descriptions** (shown in the command UI):

| Field | Description |
|-------|-------------|
| `toolCallWindow` | Number of recent tool calls to scan for repeats |
| `exactRepeatThreshold` | Consecutive identical calls before flagging |
| `fuzzySimilarityThreshold` | Jaccard similarity threshold (0.0–1.0) |
| `cycleLength` | Length of tool call cycle pattern to detect |
| `cycleRepetitions` | Times a cycle must repeat before flagging |
| `thinkingWindow` | Number of recent thinking blocks to compare |
| `thinkingSimilarityThreshold` | N-gram similarity threshold (0.0–1.0) |
| `thinkingMinLength` | Minimum thinking block length to analyze |
| `resultStagnationThreshold` | Identical results before flagging stagnation |
| `hintAfter` | Detections before injecting a system hint |
| `blockAfter` | Detections before blocking the tool call |
| `blockBeforeTerminate` | Blocked calls before terminating the agent |
| `maxTurns` | Hard turn limit (null = unlimited) |

---

### 4. `tool-tracker.ts`

**Purpose**: Detect tool call loops — exact repeats, fuzzy repeats, and cycles.

**Exports**:

```typescript
export class ToolTracker {
  constructor(config: LoopGuardConfig);

  /**
   * Record a tool call and check for loops.
   * Returns a detection result or null if no loop found.
   */
  check(toolName: string, args: Record<string, unknown>): ToolLoopDetection | null;

  /** Reset tracking state (called on session_start or /new). */
  reset(): void;
}

export interface ToolLoopDetection {
  type: "exact" | "fuzzy" | "cycle";
  toolName: string;
  consecutiveCount: number;
  details: string;   // Human-readable description
}
```

**Internal state**:

```typescript
interface ToolCallSignature {
  toolName: string;
  argsHash: string;       // JSON.stringify with sorted keys
  argsRaw: Record<string, unknown>;
}

// Sliding window of recent tool calls
private recentCalls: ToolCallSignature[] = [];

// Track consecutive exact repeats per tool name
private consecutiveExact: Map<string, number> = new Map();

// Track tool name sequence for cycle detection
private toolNameSequence: string[] = [];
```

**Detection logic**:

1. **Exact repeat**: Compare `(toolName, sorted JSON args)` against the last `toolCallWindow` entries. If `exactRepeatThreshold` consecutive calls match → detection.

2. **Fuzzy repeat**: For each recent call with the same tool name, compute `jaccardSimilarity` between serialized args. If any exceeds `fuzzySimilarityThreshold` AND it's not an exact match → detection.

3. **Cycle detection**: Track sequence of tool names. After each call, check if the last `cycleLength × cycleRepetitions` entries form a repeating pattern of length `cycleLength`.

**Normalization**:
- `args` are serialized via `JSON.stringify(sortKeys(args))` for consistent comparison
- Keys are recursively sorted to avoid false negatives from key ordering

---

### 5. `thinking-tracker.ts`

**Purpose**: Detect repetitive thinking/reasoning content in assistant messages.

**Exports**:

```typescript
export class ThinkingTracker {
  constructor(config: LoopGuardConfig);

  /**
   * Check a thinking text block for repetition against recent blocks.
   * Returns a detection result or null.
   */
  check(thinkingText: string): ThinkingLoopDetection | null;

  /** Reset tracking state. */
  reset(): void;
}

export interface ThinkingLoopDetection {
  type: "thinking_loop";
  consecutiveCount: number;
  similarity: number;
  details: string;
}
```

**Internal state**:

```typescript
// Sliding window of recent thinking blocks
private recentThinking: string[] = [];
```

**Detection logic**:

1. On each `message_end` with `role: "assistant"`, extract thinking content:
   - Primary: `content` entries with `type: "thinking"` → extract `.text` or `.thinking` field
   - Fallback: If no structured thinking found, scan `type: "text"` content for ````thinking ... ```` code fences

2. Normalize the thinking text:
   - Trim whitespace
   - Collapse multiple whitespace to single spaces
   - Cap at 2000 characters (performance safeguard)
   - Skip if shorter than `thinkingMinLength`

3. Compare against each entry in `recentThinking` using `ngramSimilarity(text, recent, 2)`.

4. If any comparison exceeds `thinkingSimilarityThreshold` → detection. Track consecutive detections.

---

### 6. `result-tracker.ts`

**Purpose**: Detect result stagnation — same tool returning the same result repeatedly.

**Exports**:

```typescript
export class ResultTracker {
  constructor(config: LoopGuardConfig);

  /**
   * Record a tool result and check for stagnation.
   * Returns a detection result or null.
   */
  check(toolName: string, resultText: string): ResultStagnationDetection | null;

  /** Reset tracking state. */
  reset(): void;
}

export interface ResultStagnationDetection {
  type: "result_stagnation";
  toolName: string;
  consecutiveCount: number;
  details: string;
}
```

**Internal state**:

```typescript
// Per-tool-name: sliding window of recent result hashes
private recentResults: Map<string, string[]> = new Map();
```

**Detection logic**:

1. On each `tool_result`, extract text from content:
   - If content is array of `{ type: "text", text: string }` → join texts
   - If content is string → use directly
   - Normalize: trim, collapse whitespace

2. Compute a lightweight hash (simple string-based, not crypto):
   - Use `resultText.slice(0, 500)` to avoid hashing huge outputs
   - Store the truncated text directly (exact string comparison is sufficient)

3. For the tool name's result window, check if the last `resultStagnationThreshold` entries are identical.

---

### 7. `escalation.ts`

**Purpose**: Manage escalation state per detection type and generate corrective messages.

**Exports**:

```typescript
export class EscalationManager {
  constructor(config: LoopGuardConfig);

  /**
   * Record a detection and return the current escalation action.
   */
  record(detection: LoopDetection): EscalationAction;

  /**
   * Get the system prompt hint to inject, based on current escalation state.
   * Returns null if no hint needed.
   */
  getSystemPromptHint(): string | null;

  /**
   * Check if the agent should be terminated.
   */
  shouldTerminate(): boolean;

  /** Reset all escalation counters. */
  reset(): void;

  /** Get a summary of the current loop state for user notification. */
  getSummary(): string;
}

export type EscalationAction =
  | { level: "none" }
  | { level: "hint"; message: string }
  | { level: "block"; reason: string }
  | { level: "terminate"; reason: string };

export type LoopDetection =
  | ToolLoopDetection
  | ThinkingLoopDetection
  | ResultStagnationDetection;
```

**Escalation ladder**:

| Detection count | Action | What happens |
|-----------------|--------|--------------|
| `< hintAfter` | None | Silent — just tracking |
| `>= hintAfter, < blockAfter` | Hint | Inject system prompt message |
| `>= blockAfter, <= blockAfter + blockBeforeTerminate - 1` | Block | Block the tool call + inject hint |
| `> blockAfter + blockBeforeTerminate - 1` | Terminate | Signal agent termination |

**System prompt hints** (progressively stronger):

Level 1 (first hint):
```
⚠ Loop detected: You appear to be repeating the same action or reasoning pattern.
Try a different approach — consider what information you're missing or what alternative tool might help.
```

Level 2 (second hint):
```
⚠ Loop detected (continued): You are repeating the same pattern again.
Stop the current approach. Analyze what has already been done and choose a distinctly different next step.
If you have enough information to answer, do so now.
```

Level 3+ (block level):
```
🚫 Blocked: Repeated loop detected. The same action has been attempted multiple times without progress.
You must try a fundamentally different approach or conclude with the information available.
```

**Termination message**:
```
🛑 Agent terminated: LoopGuard detected persistent looping behavior after N attempts.
Summary: [details of what was looping]
```

---

### 8. `index.ts` (Extension Entry Point)

**Purpose**: Wire all modules together, register event handlers and the config command.

**Structure**:

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, cloneConfig, registerConfigCommand, type LoopGuardConfig } from "./config";
import { ToolTracker, type ToolLoopDetection } from "./tool-tracker";
import { ThinkingTracker, type ThinkingLoopDetection } from "./thinking-tracker";
import { ResultTracker, type ResultStagnationDetection } from "./result-tracker";
import { EscalationManager, type LoopDetection } from "./escalation";

export default function (pi: ExtensionAPI) {
  // Shared mutable config (updated by /loop-guard config command)
  const config: LoopGuardConfig = cloneConfig(DEFAULT_CONFIG);

  // Sub-modules
  const toolTracker = new ToolTracker(config);
  const thinkingTracker = new ThinkingTracker(config);
  const resultTracker = new ResultTracker(config);
  const escalation = new EscalationManager(config);

  // Register config command
  registerConfigCommand(pi, config);

  // ── Event Handlers ──

  pi.on("session_start", async (_event, ctx) => {
    toolTracker.reset();
    thinkingTracker.reset();
    resultTracker.reset();
    escalation.reset();
    ctx.ui.notify("loop-guard: active", "info");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const hint = escalation.getSystemPromptHint();
    if (hint) {
      return { systemPrompt: event.systemPrompt + "\n\n" + hint };
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    // Check escalation state first
    const action = escalation.getPendingAction();
    if (action?.level === "terminate") {
      ctx.ui.notify("loop-guard: terminating agent due to persistent loops", "error");
      return { block: true, reason: "LoopGuard: agent terminated due to persistent looping" };
    }

    // Check for tool call loops
    const detection = toolTracker.check(event.toolName, event.input);
    if (detection) {
      handleDetection(detection, escalation, ctx);
      const action = escalation.getCurrentAction();
      if (action.level === "block") {
        return { block: true, reason: action.reason };
      }
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    const resultText = extractResultText(event.content);
    const detection = resultTracker.check(event.toolName, resultText);
    if (detection) {
      handleDetection(detection, escalation, ctx);
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const thinkingText = extractThinkingContent(event.message);
    if (thinkingText) {
      const detection = thinkingTracker.check(thinkingText);
      if (detection) {
        handleDetection(detection, escalation, ctx);
      }
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    // Optional: max turns safety net
    if (config.maxTurns && event.turnIndex >= config.maxTurns) {
      ctx.ui.notify(`loop-guard: max turns (${config.maxTurns}) reached`, "warning");
      // Can't directly terminate from turn_end, but we can flag it
    }
  });
}

function handleDetection(
  detection: LoopDetection,
  escalation: EscalationManager,
  ctx: ExtensionContext,
): void {
  const action = escalation.record(detection);

  switch (action.level) {
    case "hint":
      ctx.ui.notify(`loop-guard: ${action.message}`, "warning");
      break;
    case "block":
      ctx.ui.notify(`loop-guard: ${action.reason}`, "error");
      break;
    case "terminate":
      ctx.ui.notify(`loop-guard: ${action.reason}`, "error");
      break;
  }
}

function extractResultText(content: unknown): string {
  // Handle both array format and string format
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  return typeof content === "string" ? content : String(content);
}

function extractThinkingContent(message: any): string | null {
  if (!message.content || !Array.isArray(message.content)) return null;

  // Primary: structured thinking content
  const thinkingBlock = message.content.find(
    (c: any) => c.type === "thinking"
  );
  if (thinkingBlock) {
    return thinkingBlock.text ?? thinkingBlock.thinking ?? null;
  }

  // Fallback: scan text content for ```thinking fences
  for (const block of message.content) {
    if (block.type === "text" && block.text) {
      const match = block.text.match(/```thinking\s*([\s\S]*?)```/);
      if (match) return match[1].trim();
    }
  }

  return null;
}
```

---

## Implementation Order

1. **`package.json`** — Extension metadata
2. **`similarity.ts`** — Pure functions, no dependencies on other modules
3. **`config.ts`** — Config interface + defaults + command
4. **`tool-tracker.ts`** — Tool call loop detection
5. **`thinking-tracker.ts`** — Thinking loop detection
6. **`result-tracker.ts`** — Result stagnation detection
7. **`escalation.ts`** — Escalation state machine
8. **`index.ts`** — Wire everything together

Each module is independently testable (pure functions or classes with clear interfaces).

---

## Edge Cases & Safeguards

| Case | Handling |
|------|----------|
| Empty tool args | Treated as distinct signature `{}` |
| Very long thinking blocks (> 5KB) | Truncated to 2000 chars for comparison |
| Short thinking blocks (< `thinkingMinLength`) | Skipped entirely |
| Mixed content types in tool results | Only `type: "text"` blocks are compared |
| Parallel tool calls (same turn) | Each call tracked independently |
| Session switch (`/new`, `/resume`) | All trackers reset on `session_start` |
| Config changed mid-session | Changes take effect immediately (mutable reference) |
| Agent termination signal | Blocked via `{ block: true }` on all subsequent tool calls |
