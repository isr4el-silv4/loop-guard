# plan-03: User-Triggered Reset After Termination

## Problem

When the agent is terminated (`shouldTerminate()` → `true`), **every subsequent tool call is blocked indefinitely**. The session is wasted — the only escape is starting a new session, which discards all progress (conversation context, intermediate work, etc.).

```
Detection 1 → Hint
Detection 2 → Block
Detection 3 → Block
Detection 4 → Block
Detection 5 → Terminate (shouldTerminate() = true)
Detection 6 → Block (forever, no recovery)
...
```

## Solution

Add a **`/loop-guard reset`** command the user can run to clear all loop-guard state mid-session. After reset, the agent continues with fresh counters and can proceed normally.

### User Flow

```
Agent enters loop → hint → block → terminate
User sees: "🛑 Agent terminated. Run /loop-guard reset to continue."
User types: /loop-guard reset
System: "loop-guard: reset — all counters cleared, agent may continue."
Agent resumes with fresh state.
```

---

## Changes

### 1. `config.ts` — Subcommand Routing + Reset Handler

The `/loop-guard` command currently opens the config menu unconditionally. Change it to route based on arguments:

| Command | Action |
|---------|--------|
| `/loop-guard` (no args) | Open config menu (current behavior) |
| `/loop-guard reset` | Reset all loop-guard state |
| `/loop-guard config` | Open config menu (explicit) |

#### 1a. Change `registerConfigCommand` to accept reset callback

The config module doesn't own the trackers — `index.ts` does. So pass a reset callback:

```typescript
export function registerConfigCommand(
  pi: ExtensionAPI,
  config: LoopGuardConfig,
  onReset?: () => void,  // NEW: callback to reset all trackers + escalation
): void {
  pi.registerCommand("loop-guard", {
    description: "Configure loop-guard detection settings or reset state",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim().toLowerCase();

      if (trimmed === "reset") {
        if (onReset) {
          onReset();
        }
        ctx.ui.notify("loop-guard: reset — all counters cleared, agent may continue.", "info");
        return;
      }

      if (trimmed === "config" || trimmed === "") {
        await configMenu(ctx, config);
        return;
      }

      ctx.ui.notify(`loop-guard: unknown subcommand "${trimmed}". Available: reset, config`, "warning");
    },
  });
}
```

### 2. `index.ts` — Wire Reset + Improve Termination Message

#### 2a. Pass reset callback to `registerConfigCommand`

```typescript
registerConfigCommand(pi, config, () => {
  toolTracker.reset();
  thinkingTracker.reset();
  resultTracker.reset();
  escalation.reset();
});
```

#### 2b. Improve termination notification

Current termination message in `tool_call`:

```typescript
if (escalation.shouldTerminate()) {
  ctx.ui.notify("loop-guard: terminating agent due to persistent loops", "error");
  return { block: true, reason: "loop-guard: agent terminated due to persistent looping" };
}
```

Change to include the reset command hint:

```typescript
if (escalation.shouldTerminate()) {
  ctx.ui.notify(
    "loop-guard: agent terminated due to persistent looping. Run /loop-guard reset to continue.",
    "error",
  );
  return {
    block: true,
    reason: "loop-guard: agent terminated due to persistent looping. Run /loop-guard reset to continue.",
  };
}
```

#### 2c. Also improve the `terminate` action reason in `escalation.ts`

Current:

```typescript
return {
  level: "terminate",
  reason: `🛑 Agent terminated: loop-guard detected persistent looping behavior after ${this.detectionCount} attempts.`,
};
```

Change to:

```typescript
return {
  level: "terminate",
  reason: `🛑 Agent terminated: loop-guard detected persistent looping behavior after ${this.detectionCount} attempts.\nRun /loop-guard reset to continue.`,
};
```

---

## Files to Modify

| File | Change |
|------|--------|
| `config.ts` | Add subcommand routing to `registerConfigCommand`, accept optional `onReset` callback |
| `index.ts` | Pass reset callback to `registerConfigCommand`, improve termination message |
| `escalation.ts` | Add reset hint to terminate reason string |
| `test/config.test.ts` | No changes (command registration is integration-level, tested via index) |
| `test/escalation.test.ts` | Add test for reset hint in terminate reason |

## Files NOT to Modify

| File | Reason |
|------|--------|
| `tool-tracker.ts` | No changes — reset is already implemented |
| `thinking-tracker.ts` | No changes — reset is already implemented |
| `result-tracker.ts` | No changes — reset is already implemented |
| `similarity.ts` | No changes |

---

## Backward Compatibility

- `/loop-guard` with no args still opens the config menu (unchanged)
- Existing escalation behavior is unchanged (only the terminate message text changes)
- The reset callback is optional (`onReset?`) so existing callers without reset logic won't break
