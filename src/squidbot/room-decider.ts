// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/decider/room-routing.ts @ 96ff8445.
// Modified: optional model reply. A bad or late reply falls back to the room lead.

import type { DeciderChoice } from "./rooms.js";

export function decideFromModelText(text: string): DeciderChoice {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { choice: "", probability: 0 };
    const record = parsed as { choice?: unknown; probability?: unknown };
    if (typeof record.choice === "string" && typeof record.probability === "number") {
      return { choice: record.choice, probability: record.probability };
    }
  } catch {
    // The lead answers when the model reply is not the routing JSON.
  }
  return { choice: "", probability: 0 };
}
