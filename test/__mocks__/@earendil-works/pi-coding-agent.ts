// Manual mock for @earendil-works/pi-coding-agent

export interface ExtensionContext {
  ui: {
    notify: (message: string, level?: string) => void;
    select: (prompt: string, choices: string[]) => Promise<string | null>;
    input: (prompt: string, description?: string) => Promise<string | null>;
  };
  abort: () => void;
}

export interface ExtensionCommandContext {
  ui: {
    notify: (message: string, level?: string) => void;
    select: (prompt: string, choices: string[]) => Promise<string | null>;
    input: (prompt: string, description?: string) => Promise<string | null>;
  };
}

export interface ExtensionAPI {
  on: (event: string, handler: (...args: unknown[]) => void | Promise<void>) => void;
  registerCommand: (name: string, options: { description: string; handler: (args: string, ctx: ExtensionCommandContext) => void | Promise<void>; getArgumentCompletions?: (prefix: string) => { value: string; label: string }[] }) => void;
}
