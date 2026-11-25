// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: a room bot turn goes through the existing agent command.

import type { RuntimeEnv } from "../runtime.js";

export async function runRoomAgentTurn(input: {
  agentId: string;
  sessionKey: string;
  message: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const { agentCommand } = await import("../agents/agent-command.js");
  const lines: string[] = [];
  const runtime: RuntimeEnv = {
    log: (...args) => lines.push(args.map(String).join(" ")),
    error: (...args) => lines.push(args.map(String).join(" ")),
    exit: () => undefined,
  };
  const result: unknown = await agentCommand(
    {
      message: input.message,
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      deliver: false,
      abortSignal: input.abortSignal,
    },
    runtime,
  );
  if (typeof result === "string" && result.trim()) return result.trim();
  if (result && typeof result === "object" && "text" in result && typeof result.text === "string" && result.text.trim()) {
    return result.text.trim();
  }
  const logged = lines.join("\n").trim();
  if (logged) return logged;
  throw new Error("agent turn returned no text");
}
