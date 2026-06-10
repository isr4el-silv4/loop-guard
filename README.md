# loop-guard

![loop-guard](https://raw.githubusercontent.com/isr4el-silv4/loop-guard/master/screenshot.jpeg)

Pi extension that detects and prevents LLM looping behavior in real-time across tool calls, thinking blocks, and streaming output.

## Why

LLMs can get stuck in repetitive loops: calling the same tool with the same arguments, repeating identical reasoning, or producing stagnant output. This wastes tokens, time, and can cause agents to run indefinitely without making progress.

loop-guard watches for these patterns and escalates progressively:

1. **Hint** — Inject a system prompt nudge to steer the model off its current path
2. **Block** — Reject the tool call or abort streaming with a strong corrective message
3. **Terminate** — Stop the agent entirely after persistent looping

## Detection Modes

### Tool Call Loops

Detects three patterns in tool calls:

| Pattern | Description |
|---------|-------------|
| **Exact repeat** | Same tool + identical arguments called consecutively |
| **Fuzzy repeat** | Same tool with similar arguments (Jaccard similarity) |
| **Cycle** | Repeating sequence of different tools (e.g. `read → edit → read → edit`) |

### Thinking Loops (Streaming)

Detects repetitive reasoning in real-time during streaming:

| Pattern | Description |
|---------|-------------|
| **Consecutive** | N consecutive similar lines (exact match or n-gram similarity) |
| **Density** | High repetition density in a sliding window (mode-based) |

Uses a **two-stage escalation** within a single prompt: warn on first detection, abort on second. This avoids false positives from legitimate repetitive output (e.g. listing items).

### Thinking Loops (Post-Hoc)

At `message_end`, analyzes complete thinking blocks for repetitive patterns using n-gram similarity across a sliding window.

### Result Stagnation

Detects when the same tool returns identical results repeatedly, indicating the agent is stuck in a non-productive cycle.

## Installation

Drop this directory into your Pi extensions folder:

```
~/.pi/agent/extensions/loop-guard/
```

Pi loads it automatically on startup. You'll see `loop-guard: active` in the notification log.

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/loop-guard reset` | Clear all detection counters and allow the agent to continue |
| `/loop-guard config` | Open interactive config menu to adjust thresholds |
| `/loop-guard` | Same as `config` (opens menu) |

### Configuration

Run `/loop-guard config` to pick a setting and edit it. Key fields:

#### Tool Call Detection

| Field | Default | Description |
|-------|---------|-------------|
| `toolCallWindow` | 5 | Recent tool calls to scan |
| `exactRepeatThreshold` | 2 | Consecutive identical calls before flagging |
| `fuzzySimilarityThreshold` | 0.85 | Jaccard similarity threshold (0.0–1.0) |
| `cycleLength` | 2 | Tools in a repeating cycle pattern |
| `cycleRepetitions` | 2 | Times a cycle must repeat |
| `cycleSimilarityThreshold` | 0.7 | Argument similarity for cycle confirmation |

#### Thinking Loop Detection

| Field | Default | Description |
|-------|---------|-------------|
| `thinkingWindow` | 3 | Recent thinking blocks to compare (post-hoc) |
| `thinkingSimilarityThreshold` | 0.8 | N-gram similarity threshold (post-hoc) |
| `thinkingMinLength` | 100 | Min chars to analyze (shorter blocks skipped) |

#### Streaming Detection

| Field | Default | Description |
|-------|---------|-------------|
| `consecutiveThreshold` | 4 | Consecutive similar lines to trigger |
| `densityThreshold` | 0.75 | Repetition density to trigger |
| `densityWindow` | 100 | Sliding window size for density |
| `lineSimilarityThreshold` | 0.85 | N-gram threshold for near-identical lines |
| `maxBufferSize` | 10240 | Chunk buffer cap in bytes |
| `escalationTurns` | 2 | Loop detections per prompt before abort |

#### Result Stagnation

| Field | Default | Description |
|-------|---------|-------------|
| `resultStagnationThreshold` | 3 | Consecutive identical results before flagging |

#### Escalation

| Field | Default | Description |
|-------|---------|-------------|
| `hintAfter` | 1 | Detections before system prompt hint |
| `blockAfter` | 2 | Detections before blocking |
| `blockBeforeTerminate` | 3 | Blocked calls before termination |
| `maxTurns` | null | Hard turn limit (null = unlimited) |

## Architecture

```
index.ts              Extension entry point, wires Pi events to trackers
├── tool-tracker.ts   Detects exact, fuzzy, and cycle patterns in tool calls
├── thinking-tracker.ts  Streaming + post-hoc thinking loop detection
├── result-tracker.ts   Detects identical results from the same tool
├── escalation.ts     Multi-level escalation (hint → block → terminate)
├── similarity.ts     Jaccard + n-gram similarity utilities
└── config.ts         Config schema, defaults, /loop-guard command
```

### Event Flow

```
session_start  →  reset all trackers
agent_start    →  reset thinking tracker (full)
message_start  →  reset thinking tracker (per-message)
message_update →  onChunk() / onThinkingEnd() (streaming detection)
tool_call      →  toolTracker.check() → escalate if loop found
tool_result    →  resultTracker.check() → escalate if stagnant
message_end    →  thinkingTracker.check() (post-hoc detection)
turn_end       →  max turns safety net
```

## Testing

```bash
npm test
```

88 tests covering all detection modes, escalation paths, similarity algorithms, and edge cases.
