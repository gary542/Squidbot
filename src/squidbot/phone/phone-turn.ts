// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: a phone turn uses the same agent command as a room bot, then streams the text in chunks.

import { runRoomAgentTurn } from "../room-turn.js";
import type { PhoneTranscriptLine } from "./phone-session.js";

export type PhoneFrame =
  | { v: 1; kind: "chunk"; text: string }
  | { v: 1; kind: "done" }
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

export function phoneDoneFrame(): PhoneFrame {
  return { v: 1, kind: "done" };
}

export function phoneErrorFrame(code: "bot_held" | "spend_cap" | "loop" | "failed"): PhoneFrame {
  return { v: 1, kind: "error", code, message: friendlyPhoneError(code) };
}

export function parsePhoneFrame(text: string): PhoneFrame | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return null;
    const row = value as { v?: unknown; kind?: unknown; text?: unknown; code?: unknown; message?: unknown };
    if (row.v !== 1) return null;
    if (row.kind === "chunk" && typeof row.text === "string") return { v: 1, kind: "chunk", text: row.text };
    if (row.kind === "done") return { v: 1, kind: "done" };
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

export async function streamText(text: string, size: number, onChunk: (text: string) => Promise<void> | void): Promise<void> {
  const step = Math.max(1, size);
  for (let index = 0; index < text.length; index += step) {
    await onChunk(text.slice(index, index + step));
  }
}

export async function runPhoneAgentTurn(input: {
  agentId: string;
  sessionKey: string;
  message: string;
  history: readonly PhoneTranscriptLine[];
  onChunk: (text: string) => Promise<void> | void;
  turn?: (input: { agentId: string; sessionKey: string; message: string }) => Promise<string>;
}): Promise<void> {
  const turn = input.turn ?? runRoomAgentTurn;
  const text = await turn({ agentId: input.agentId, sessionKey: input.sessionKey, message: input.message });
  await streamText(text, 24, input.onChunk);
}
