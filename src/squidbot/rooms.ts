// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/decider/room-routing.ts @ 96ff8445.
// Modified: the decider is injected. Session wiring waits on SQUIDBOT_ROOMS=1.

export const ROOM_ROUTING_TIMEOUT_MS = 1_500;
export const ROOM_ROUTING_MIN_PROBABILITY = 0.6;
export const EVERYONE_OPTION = "__everyone__";
export const ROOM_ROUTING_INSTRUCTIONS =
  "Which bot in this room should answer `new_message`? Choose __everyone__ only when the message needs several members to answer.";

export interface RoomMember {
  id: string;
  name: string;
  title?: string;
  description?: string;
  /** Room lead used when the decider is late, unsure, or unavailable. */
  lead?: boolean;
}

export interface RoomRoutingInput {
  room: string;
  humans: string[];
  members: RoomMember[];
  recent: Array<{ from: string; text: string }>;
  message: { from: string; text: string };
}

export type RoomRoute =
  | { kind: "member"; botId: string; probability: number }
  | { kind: "everyone"; probability: number }
  | { kind: "fallback"; botId: string; reason: "low_confidence" | "timeout" | "no_choice" | "malformed" | "error" };

export interface DeciderChoice {
  choice: string;
  probability: number;
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function roomRoutingRequest(input: RoomRoutingInput) {
  const options: Record<string, string> = {};
  for (const member of input.members) {
    const title = member.title ? `, ${clip(member.title, 120)}` : "";
    const description = member.description ? ` ${clip(member.description, 400)}` : "";
    options[member.id] = `${clip(member.name, 80) || "Unnamed bot"}${title} bot.${description}`;
  }
  options[EVERYONE_OPTION] = "Several members need to answer.";
  let used = 0;
  const recent: RoomRoutingInput["recent"] = [];
  for (let index = input.recent.length - 1; index >= 0; index -= 1) {
    const line = input.recent[index]!;
    const text = clip(line.text, 500);
    if (!text) continue;
    const size = text.length + line.from.length;
    if (used + size > 6_000) break;
    used += size;
    recent.unshift({ from: clip(line.from, 80), text });
  }
  return {
    instructions: ROOM_ROUTING_INSTRUCTIONS,
    options,
    state: {
      room: clip(input.room, 80),
      humans_in_room: input.humans.map((human) => clip(human, 80)),
      bots_in_room: input.members.map((member) => clip(member.name, 80)),
      ...(recent.length ? { recent_messages: recent } : {}),
      new_message: { from: clip(input.message.from, 80), text: input.message.text.trim().slice(0, 8_000) },
    },
  };
}

export function leadOf(members: readonly RoomMember[]): string {
  return members.find((member) => member.lead)?.id ?? members[0]?.id ?? "";
}

export function roomsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SQUIDBOT_ROOMS === "1";
}

export async function decideRoomResponder(
  input: RoomRoutingInput,
  choose: (request: ReturnType<typeof roomRoutingRequest>, timeoutMs: number) => Promise<DeciderChoice>,
  options: { timeoutMs?: number } = {},
): Promise<RoomRoute> {
  const lead = leadOf(input.members);
  if (input.members.length < 2) return { kind: "fallback", botId: lead, reason: "no_choice" };
  const timeoutMs = options.timeoutMs ?? ROOM_ROUTING_TIMEOUT_MS;
  try {
    const request = roomRoutingRequest(input);
    const result = await Promise.race([
      choose(request, timeoutMs),
      new Promise<DeciderChoice>((_, reject) => {
        setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    if (result.probability < ROOM_ROUTING_MIN_PROBABILITY) {
      return { kind: "fallback", botId: lead, reason: "low_confidence" };
    }
    if (result.choice === EVERYONE_OPTION) return { kind: "everyone", probability: result.probability };
    if (!input.members.some((member) => member.id === result.choice)) {
      return { kind: "fallback", botId: lead, reason: "malformed" };
    }
    return { kind: "member", botId: result.choice, probability: result.probability };
  } catch (error) {
    const reason = error instanceof Error && error.message === "timeout" ? "timeout" : "error";
    return { kind: "fallback", botId: lead, reason };
  }
}
