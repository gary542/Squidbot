// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: phone replies follow the assistant stream, one delta at a time.

import { runRoomAgentTurn } from "../room-turn.js";
import type { PhoneTranscriptLine } from "./phone-session.js";

type AssistantEvent = {
  sessionKey?: string;
  stream?: string;
  data?: { delta?: unknown; text?: unknown };
};

type Unsubscribe = () => void;

export class PhoneTurnStopped extends Error {
  constructor() {
    super("stopped");
    this.name = "PhoneTurnStopped";
  }
}

export type PhoneFrame =
  | { v: 1; kind: "chunk"; text: string }
  | { v: 1; kind: "done"; text: string; stopped?: boolean }
  | { v: 1; kind: "stop" }
  | { v: 1; kind: "error"; code: "bot_held" | "spend_cap" | "loop" | "failed"; message: string };

export function friendlyPhoneError(code: string): string {
  if (code === "bot_held") return "This bot is paused.";
  if (code === "spend_cap") return "The spend cap is reached.";
  if (code === "loop") return "This chat stopped so it would not keep going.";
  return "The bot could not answer.";
}

export function phoneChunkFrame(text: string): PhoneFrame {
  return { v: 1, kind: "chunk", text };
}

export function phoneDoneFrame(text: string, stopped = false): PhoneFrame {
  return stopped ? { v: 1, kind: "done", text, stopped: true } : { v: 1, kind: "done", text };
}

export function phoneStopFrame(): PhoneFrame {
  return { v: 1, kind: "stop" };
}

export function phoneErrorFrame(code: "bot_held" | "spend_cap" | "loop" | "failed"): PhoneFrame {
  return { v: 1, kind: "error", code, message: friendlyPhoneError(code) };
}

export function parsePhoneFrame(text: string): PhoneFrame | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return null;
    const row = value as { v?: unknown; kind?: unknown; text?: unknown; code?: unknown; message?: unknown; stopped?: unknown };
    if (row.v !== 1) return null;
    if (row.kind === "chunk" && typeof row.text === "string") return { v: 1, kind: "chunk", text: row.text };
    if (row.kind === "done") {
      return {
        v: 1,
        kind: "done",
        text: typeof row.text === "string" ? row.text : "",
        ...(row.stopped === true ? { stopped: true } : {}),
      };
    }
    if (row.kind === "stop") return { v: 1, kind: "stop" };
    if (
      row.kind === "error" &&
      (row.code === "bot_held" || row.code === "spend_cap" || row.code === "loop" || row.code === "failed") &&
      typeof row.message === "string"
    ) {
      return { v: 1, kind: "error", code: row.code, message: row.message };
    }
    return null;
  } catch {
    return null;
  }
}

export async function runPhoneAgentTurn(input: {
  agentId: string;
  sessionKey: string;
  message: string;
  history: readonly PhoneTranscriptLine[];
  signal?: AbortSignal;
  onDelta: (text: string) => Promise<void>;
  subscribe?: (listener: (event: AssistantEvent) => void) => Unsubscribe;
  turn?: (input: { agentId: string; sessionKey: string; message: string; abortSignal?: AbortSignal }) => Promise<string>;
}): Promise<string> {
  const signal = input.signal ?? new AbortController().signal;
  let previous = "";
  let chain: Promise<void> = Promise.resolve();
  let streamed = "";
  const subscribe = input.subscribe ?? (await defaultAssistantSubscribe());
  const unsubscribe = subscribe((event) => {
    if (signal.aborted || event.sessionKey !== input.sessionKey || event.stream !== "assistant") return;
    const delta = assistantDelta(previous, event.data);
    if (!delta) return;
    previous += delta;
    chain = chain.then(async () => {
      if (signal.aborted) return;
      streamed += delta;
      await input.onDelta(delta);
    });
  });
  const turn = input.turn ?? runRoomAgentTurn;
  try {
    const text = await turn({
      agentId: input.agentId,
      sessionKey: input.sessionKey,
      message: input.message,
      abortSignal: signal,
    });
    await chain;
    if (!signal.aborted && streamed.length === 0 && text) {
      streamed = text;
      await input.onDelta(text);
    }
    return signal.aborted ? streamed : text || streamed;
  } catch (error) {
    await chain.catch(() => undefined);
    if (signal.aborted) return streamed;
    throw error;
  } finally {
    unsubscribe();
  }
}

function assistantDelta(previous: string, data: AssistantEvent["data"]): string {
  if (!data) return "";
  if (typeof data.delta === "string" && typeof data.text !== "string") return data.delta;
  if (typeof data.text === "string") {
    if (data.text.startsWith(previous)) return data.text.slice(previous.length);
    return typeof data.delta === "string" ? data.delta : data.text;
  }
  return typeof data.delta === "string" ? data.delta : "";
}

async function defaultAssistantSubscribe(): Promise<(listener: (event: AssistantEvent) => void) => Unsubscribe> {
  const { onAgentEvent } = await import("../../infra/agent-events.js");
  return (listener) => onAgentEvent((event) => listener(event));
}
