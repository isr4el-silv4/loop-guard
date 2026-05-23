import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, cloneConfig, registerConfigCommand, type LoopGuardConfig } from "./config";
import { ToolTracker } from "./tool-tracker";
import { ThinkingTracker } from "./thinking-tracker";
import { ResultTracker } from "./result-tracker";
import { EscalationManager, type LoopDetection } from "./escalation";

export default function (pi: ExtensionAPI) {
  // Shared mutable config (updated by /loop-guard config command)
  const config: LoopGuardConfig = cloneConfig(DEFAULT_CONFIG);

  // Sub-modules
  const toolTracker = new ToolTracker(config);
  const thinkingTracker = new ThinkingTracker(config);
  const resultTracker = new ResultTracker(config);
  const escalation = new EscalationManager(config);

  // Register config command with reset callback
  registerConfigCommand(pi, config, () => {
    toolTracker.reset();
    thinkingTracker.reset();
    resultTracker.reset();
    escalation.reset();
  });

  // ── Event Handlers ──

  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    toolTracker.reset();
    thinkingTracker.reset();
    resultTracker.reset();
    escalation.reset();
    ctx.ui.notify("loop-guard: active", "info");
  });

  // ── Streaming Loop Detection (Plan 04) ──

  // Full reset on new prompt
  pi.on("agent_start", async (_event: unknown, _ctx: ExtensionContext) => {
    thinkingTracker.reset();
  });

  // Reset per-message state on assistant message start
  pi.on("message_start", async (event: { message: unknown }, _ctx: ExtensionContext) => {
    if (typeof event.message !== "object" || event.message === null) return;
    const message = event.message as Record<string, unknown>;
    if (message.role !== "assistant") return;
    thinkingTracker.resetMessage();
  });

  // Streaming detection: thinking_delta and thinking_end
  pi.on("message_update", async (event: unknown, ctx: ExtensionContext) => {
    const e = event as { assistantMessageEvent?: { type?: string; delta?: string } };
    if (!e.assistantMessageEvent) return;
    const type = e.assistantMessageEvent.type;

    if (type === "thinking_delta") {
      thinkingTracker.onChunk(e.assistantMessageEvent.delta ?? "", ctx);
    }

    if (type === "thinking_end") {
      thinkingTracker.onThinkingEnd(ctx);
    }
  });

  pi.on("before_agent_start", async (event: { systemPrompt: string }, _ctx: ExtensionContext) => {
    const hint = escalation.getSystemPromptHint();
    if (hint) {
      return { systemPrompt: event.systemPrompt + "\n\n" + hint };
    }
  });

  pi.on("tool_call", async (event: { toolName: string; input: Record<string, unknown> }, ctx: ExtensionContext) => {
    // Check if agent should be terminated
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

    // Check for tool call loops
    const detection = toolTracker.check(event.toolName, event.input);
    if (detection) {
      handleDetection(detection, escalation, ctx);
      const action = escalation.shouldTerminate()
        ? { level: "terminate" as const, reason: "terminated" }
        : escalation.getSystemPromptHint()
          ? { level: "block" as const, reason: escalation.getSystemPromptHint() }
          : { level: "none" as const };

      if (action.level === "block" || action.level === "terminate") {
        return { block: true, reason: action.reason };
      }
    }
  });

  pi.on("tool_result", async (event: { toolName: string; content: unknown }, ctx: ExtensionContext) => {
    const resultText = extractResultText(event.content);
    const detection = resultTracker.check(event.toolName, resultText);
    if (detection) {
      handleDetection(detection, escalation, ctx);
    }
  });

  pi.on("message_end", async (event: { message: unknown }, ctx: ExtensionContext) => {
    if (typeof event.message !== "object" || event.message === null) return;
    const message = event.message as Record<string, unknown>;
    if (message.role !== "assistant") return;

    const thinkingText = extractThinkingContent(message);
    if (thinkingText) {
      const detection = thinkingTracker.check(thinkingText);
      if (detection) {
        handleDetection(detection, escalation, ctx);
      }
    }
  });

  pi.on("turn_end", async (event: { turnIndex: number }, ctx: ExtensionContext) => {
    // Optional: max turns safety net
    if (config.maxTurns && event.turnIndex >= config.maxTurns) {
      ctx.ui.notify(`loop-guard: max turns (${config.maxTurns}) reached`, "warning");
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
      .filter((c: unknown) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text")
      .map((c: unknown) => (c as Record<string, string>).text ?? "")
      .join("\n");
  }
  return typeof content === "string" ? content : String(content);
}

function extractThinkingContent(message: Record<string, unknown>): string | null {
  const content = message.content;
  if (!content || !Array.isArray(content)) return null;

  // Primary: structured thinking content
  const thinkingBlock = content.find(
    (c: unknown) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "thinking",
  );
  if (thinkingBlock) {
    const block = thinkingBlock as Record<string, unknown>;
    const text = block.text ?? block.thinking;
    return typeof text === "string" ? text : null;
  }

  // Fallback: scan text content for ```thinking fences
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        const match = b.text.match(/```thinking\s*([\s\S]*?)```/);
        if (match) return match[1].trim();
      }
    }
  }

  return null;
}
