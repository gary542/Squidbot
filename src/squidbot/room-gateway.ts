// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/runtime/room-session.ts @ 96ff8445.
// Modified: a gateway room session. Routing, mentions, and hand-offs stay off until SQUIDBOT_ROOMS=1.

import { AssignmentTree } from "./assignments.js";
import { evaluateRunAdmission, type RunAdmissionHold } from "./gate.js";
import { decideFromModelText } from "./room-decider.js";
import { closeRoomStores, loadRooms, saveRoom } from "./room-store.js";
import {
  decideRoomResponder,
  leadOf,
  roomsEnabled,
  type DeciderChoice,
  type RoomMember,
  type RoomRoute,
  type RoomRoutingInput,
} from "./rooms.js";

export { roomsEnabled };
import { renderRoomPanel, type RoomPanel } from "./room-view.js";

export type RoomTurnRunner = (input: { agentId: string; sessionKey: string; message: string }) => Promise<string>;

let turnRunner: RoomTurnRunner | undefined;

/** Tests inject this. Production uses the agent command. */
export function setRoomTurnRunner(next?: RoomTurnRunner): void {
  turnRunner = next;
}

export const ROOM_TURN_LIMIT = 300;

export interface RoomMessage {
  from: string;
  role: "human" | "bot" | "system";
  text: string;
}

interface RoomRecord {
  id: string;
  title: string;
  humans: string[];
  members: RoomMember[];
  messages: RoomMessage[];
  tree: AssignmentTree;
  routedTurns: number;
  stopped?: string;
  stateDir?: string;
}

const rooms = new Map<string, RoomRecord>();

export function resetRooms(): void {
  rooms.clear();
  closeRoomStores();
}

function persist(room: RoomRecord): void {
  if (!room.stateDir) return;
  saveRoom(room.stateDir, {
    id: room.id,
    sessionKey: roomSessionKey(room.id),
    title: room.title,
    humans: room.humans,
    members: room.members,
    messages: room.messages,
    routedTurns: room.routedTurns,
    ...(room.stopped ? { stopped: room.stopped } : {}),
  });
}

export function reloadRooms(stateDir: string): number {
  rooms.clear();
  for (const stored of loadRooms(stateDir)) {
    rooms.set(stored.id, {
      id: stored.id,
      title: stored.title,
      humans: stored.humans,
      members: stored.members,
      messages: stored.messages,
      tree: new AssignmentTree(),
      routedTurns: stored.routedTurns,
      ...(stored.stopped ? { stopped: stored.stopped } : {}),
      stateDir,
    });
  }
  return rooms.size;
}

export function roomSessionKey(id: string): string {
  return `room:${id}`;
}

export function openRoom(input: {
  id: string;
  title: string;
  humans?: string[];
  members: RoomMember[];
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
}): RoomRecord | null {
  if (!roomsEnabled(input.env)) return null;
  const stateDir = input.stateDir ?? (input.env?.SQUIDBOT_STATE_DIR?.trim() || undefined);
  const record: RoomRecord = {
    id: input.id,
    title: input.title,
    humans: input.humans ?? [],
    members: input.members,
    messages: [],
    tree: new AssignmentTree(),
    routedTurns: 0,
    ...(stateDir ? { stateDir } : {}),
  };
  rooms.set(input.id, record);
  persist(record);
  return record;
}

export function mentionedMember(text: string, members: readonly RoomMember[]): RoomMember | "everyone" | null {
  const match = /@([A-Za-z0-9_-]+)/.exec(text);
  if (!match) return null;
  const token = match[1]!.toLowerCase();
  if (token === "everyone") return "everyone";
  return members.find((member) => member.id.toLowerCase() === token || member.name.toLowerCase() === token) ?? null;
}

function assignmentRequest(text: string, members: readonly RoomMember[]): { assignee: RoomMember; brief: string } | null {
  const match = /^\/assign\s+@([A-Za-z0-9_-]+)\s+([\s\S]+)$/.exec(text.trim());
  if (!match) return null;
  const token = match[1]!.toLowerCase();
  const assignee = members.find((member) => member.id.toLowerCase() === token || member.name.toLowerCase() === token);
  if (!assignee) return null;
  return { assignee, brief: match[2]!.trim() };
}

export interface RoomPostResult {
  enabled: boolean;
  key?: string;
  route?: RoomRoute;
  hold?: RunAdmissionHold;
  stopped?: string;
  panel?: RoomPanel;
}

export async function postRoomMessage(input: {
  roomId: string;
  from: string;
  role: "human" | "bot";
  text: string;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  choose?: (request: ReturnType<typeof import("./rooms.js").roomRoutingRequest>, timeoutMs: number) => Promise<DeciderChoice>;
  decider?: (prompt: string) => Promise<string>;
  turn?: RoomTurnRunner;
}): Promise<RoomPostResult> {
  const env = input.env ?? process.env;
  if (!roomsEnabled(env)) return { enabled: false };
  const room = rooms.get(input.roomId);
  if (!room) throw new Error(`Unknown room ${input.roomId}.`);
  if (room.stopped) return { enabled: true, key: roomSessionKey(room.id), stopped: room.stopped, panel: panelOf(room) };
  const assignment = assignmentRequest(input.text, room.members);
  if (input.role === "bot" && !assignment) {
    const previous = [...room.messages].reverse().find((message) => message.role === "bot");
    if (previous?.from === input.from) {
      room.stopped = "loop";
      room.messages.push({ from: "room", role: "system", text: "Loop guard stopped this room." });
      return { enabled: true, key: roomSessionKey(room.id), stopped: "loop", panel: panelOf(room) };
    }
    room.messages.push({ from: input.from, role: "bot", text: input.text });
    return finish(room, {});
  }
  room.messages.push({ from: input.from, role: input.role, text: input.text });
  if (assignment) {
    return finish(room, await handOff(room, input, assignment.assignee, assignment.brief));
  }
  const mention = mentionedMember(input.text, room.members);
  const routing: RoomRoutingInput = {
    room: room.title,
    humans: room.humans,
    members: room.members,
    recent: room.messages.slice(-8).map((message) => ({ from: message.from, text: message.text })),
    message: { from: input.from, text: input.text },
  };
  const choose = input.choose ?? (env.SQUIDBOT_ROOM_DECIDER === "model" ? modelChooser(input.decider, room) : undefined);
  const route = mention === "everyone"
    ? { kind: "everyone" as const, probability: 1 }
    : mention
      ? { kind: "member" as const, botId: mention.id, probability: 1 }
      : choose
        ? await decideRoomResponder(routing, choose)
        : { kind: "fallback" as const, botId: leadOf(room.members), reason: "no_choice" as const };
  const targets = route.kind === "everyone" ? room.members.map((member) => member.id) : [route.botId];
  for (const botId of targets) {
    if (room.routedTurns >= ROOM_TURN_LIMIT) {
      room.stopped = "turns";
      room.messages.push({ from: "room", role: "system", text: "This room stopped at 300 turns." });
      break;
    }
    const hold = evaluateRunAdmission({
      agentId: botId,
      trigger: input.role === "human" ? "user" : "handoff",
      handoff: input.role !== "human",
      env,
      stateDir: input.stateDir,
    });
    if (hold) {
      room.messages.push({ from: "room", role: "system", text: hold.message });
      return finish(room, { route, hold });
    }
    room.routedTurns += 1;
    const name = room.members.find((member) => member.id === botId)?.name ?? botId;
    const reply = await speak(room, botId, input.text);
    room.messages.push({ from: name, role: "bot", text: reply });
  }
  return finish(room, { route });
}

function modelChooser(
  decider: ((prompt: string) => Promise<string>) | undefined,
  room: RoomRecord,
): (request: ReturnType<typeof import("./rooms.js").roomRoutingRequest>, timeoutMs: number) => Promise<DeciderChoice> {
  return async (request, timeoutMs) => {
    const ask = decider ?? ((prompt: string) => speak(room, leadOf(room.members), prompt));
    try {
      const text = await Promise.race([
        ask(JSON.stringify(request)),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
      return decideFromModelText(text);
    } catch {
      return { choice: "", probability: 0 };
    }
  };
}

async function speak(room: RoomRecord, agentId: string, message: string): Promise<string> {
  const run = turnRunner ?? ((input) => import("./room-turn.js").then((mod) => mod.runRoomAgentTurn(input)));
  try {
    return await run({ agentId, sessionKey: roomSessionKey(room.id), message });
  } catch (error) {
    return error instanceof Error ? error.message : "agent turn failed";
  }
}

async function handOff(
  room: RoomRecord,
  input: { from: string; role: "human" | "bot"; env?: NodeJS.ProcessEnv; stateDir?: string },
  assignee: RoomMember,
  brief: string,
): Promise<Pick<RoomPostResult, "route" | "hold" | "stopped">> {
  const hold = evaluateRunAdmission({
    agentId: assignee.id,
    trigger: "handoff",
    handoff: true,
    env: input.env,
    stateDir: input.stateDir,
  });
  if (hold) {
    room.messages.push({ from: "room", role: "system", text: hold.message });
    return { hold };
  }
  try {
    const sender = room.members.find((member) => member.id === input.from || member.name === input.from);
    const parent = [...room.tree.records.values()].findLast(
      (record) => record.assigneeId === (sender?.id ?? input.from) && record.status === "running",
    );
    const record = room.tree.enqueue({
      parentId: parent?.id,
      requesterId: input.from,
      assigneeId: assignee.id,
      mode: "work",
      reply: "resume",
      brief,
    });
    room.tree.start(record.id);
    room.routedTurns += 1;
    const reply = await speak(room, assignee.id, brief);
    room.messages.push({ from: assignee.name, role: "bot", text: reply });
    return { route: { kind: "member", botId: assignee.id, probability: 1 } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hand-off stopped.";
    room.stopped = message;
    room.messages.push({ from: "room", role: "system", text: message });
    return { stopped: message };
  }
}

function panelOf(room: RoomRecord): RoomPanel {
  return {
    id: room.id,
    key: roomSessionKey(room.id),
    title: room.title,
    members: room.members.map((member) => ({ id: member.id, name: member.name, lead: member.lead === true })),
    messages: room.messages.map((message) => ({ from: message.from, role: message.role, text: message.text })),
    stopped: room.stopped,
  };
}

function finish(room: RoomRecord, extra: Pick<RoomPostResult, "route" | "hold" | "stopped">): RoomPostResult {
  persist(room);
  return { enabled: true, key: roomSessionKey(room.id), panel: panelOf(room), ...extra };
}

export function listRoomPanels(env: NodeJS.ProcessEnv = process.env): RoomPanel[] {
  if (!roomsEnabled(env)) return [];
  return [...rooms.values()].map(panelOf);
}

export function roomPanelHtml(roomId: string): string | null {
  const room = rooms.get(roomId);
  return room ? renderRoomPanel(panelOf(room)) : null;
}
