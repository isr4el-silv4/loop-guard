import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/**
 * Configuration for loop-guard detection and escalation behavior.
 */
export interface LoopGuardConfig {
  // ── Tool Call Detection ──
  toolCallWindow: number;
  exactRepeatThreshold: number;
  fuzzySimilarityThreshold: number;

  // ── Cycle Detection ──
  cycleLength: number;
  cycleRepetitions: number;

  // ── Thinking Loop Detection ──
  thinkingWindow: number;
  thinkingSimilarityThreshold: number;
  thinkingMinLength: number;

  // ── Result Stagnation ──
  resultStagnationThreshold: number;

  // ── Escalation ──
  hintAfter: number;
  blockAfter: number;
  blockBeforeTerminate: number;

  // ── Safety Net ──
  maxTurns: number | null;
}

/**
 * Human-readable descriptions for each config field, used in the /loop-guard config command.
 */
const FIELD_DESCRIPTIONS: Record<keyof LoopGuardConfig, string> = {
  toolCallWindow: "Number of recent tool calls to scan for repeats",
  exactRepeatThreshold: "Consecutive identical calls before flagging",
  fuzzySimilarityThreshold: "Jaccard similarity threshold (0.0–1.0)",
  cycleLength: "Number of tool calls in a repeating cycle pattern to detect",
  cycleRepetitions: "Times a cycle must repeat before flagging",
  thinkingWindow: "Number of recent thinking blocks to compare",
  thinkingSimilarityThreshold: "N-gram similarity threshold (0.0–1.0)",
  thinkingMinLength: "Minimum characters in a thinking block to analyze (shorter blocks are skipped)",
  resultStagnationThreshold: "Consecutive identical results from the same tool before flagging stagnation",
  hintAfter: "Number of loop detections before injecting a system prompt hint",
  blockAfter: "Number of loop detections before blocking the tool call",
  blockBeforeTerminate: "Number of blocked calls (after blocking starts) before terminating the agent",
  maxTurns: "Hard turn limit (null = unlimited)",
};

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: LoopGuardConfig = {
  toolCallWindow: 5,
  exactRepeatThreshold: 2,
  fuzzySimilarityThreshold: 0.85,
  cycleLength: 2,
  cycleRepetitions: 2,
  thinkingWindow: 3,
  thinkingSimilarityThreshold: 0.8,
  thinkingMinLength: 100,
  resultStagnationThreshold: 3,
  hintAfter: 1,
  blockAfter: 2,
  blockBeforeTerminate: 3,
  maxTurns: null,
};

/**
 * Create a shallow clone of the config.
 */
export function cloneConfig(config: LoopGuardConfig): LoopGuardConfig {
  return { ...config };
}

/**
 * Register the `/loop-guard` command that lets the user edit config fields interactively.
 */
export function registerConfigCommand(
  pi: ExtensionAPI,
  config: LoopGuardConfig,
): void {
  pi.registerCommand("loop-guard", {
    description: "Configure loop-guard detection settings",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await configMenu(ctx, config);
    },
  });
}

/**
 * Interactive config menu: let the user pick a field, see its current value,
 * and enter a new value.
 */
async function configMenu(ctx: ExtensionCommandContext, config: LoopGuardConfig): Promise<void> {
  const fields = Object.keys(FIELD_DESCRIPTIONS) as (keyof LoopGuardConfig)[];

  const choices = fields.map((f) => `${f} (${config[f]}) — ${FIELD_DESCRIPTIONS[f]}`);

  const selected = await ctx.ui.select(
    "loop-guard: pick a setting to edit",
    choices,
  );

  if (selected === null) return;

  const index = choices.indexOf(selected);
  const field = fields[index];
  const currentValue = config[field];
  const description = FIELD_DESCRIPTIONS[field];

  const prompt = `${description}\nCurrent: ${currentValue}`;
  const newValue = await ctx.ui.input(`loop-guard: new value for ${field}`, prompt);

  if (newValue === null) return;

  const parsed = parseValue(field, newValue);
  if (parsed === undefined) {
    ctx.ui.notify(`loop-guard: invalid value for ${field}`, "error");
    return;
  }

  (config as unknown as Record<string, unknown>)[field] = parsed;
  ctx.ui.notify(`loop-guard: ${field} set to ${config[field]}`, "info");
}

/**
 * Parse a user-entered string into the correct type for a given config field.
 */
function parseValue(field: keyof LoopGuardConfig, raw: string): LoopGuardConfig[keyof LoopGuardConfig] | undefined {
  const trimmed = raw.trim();

  // maxTurns accepts "null" / "none" or a number
  if (field === "maxTurns") {
    if (trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none" || trimmed === "") {
      return null;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n > 0) return n;
    return undefined;
  }

  // All other fields are numbers
  const n = Number(trimmed);
  if (Number.isFinite(n)) return n as LoopGuardConfig[keyof LoopGuardConfig];
  return undefined;
}
