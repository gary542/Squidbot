// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: room sessions live in sqlite so a restart keeps the members and the log.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RoomMember } from "./rooms.js";

export interface StoredMessage {
  from: string;
  role: "human" | "bot" | "system";
  text: string;
}

export interface StoredRoom {
  id: string;
  sessionKey: string;
  title: string;
  humans: string[];
  members: RoomMember[];
  messages: StoredMessage[];
  routedTurns: number;
  stopped?: string;
}

const databases = new Map<string, DatabaseSync>();

export function roomStorePath(stateDir: string): string {
  return path.join(stateDir, "squidbot", "rooms.sqlite");
}

function database(stateDir: string): DatabaseSync {
  const file = roomStorePath(stateDir);
  const cached = databases.get(file);
  if (cached) return cached;
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_sessions (
      id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      title TEXT NOT NULL,
      humans TEXT NOT NULL,
      members TEXT NOT NULL,
      messages TEXT NOT NULL,
      routed_turns INTEGER NOT NULL,
      stopped TEXT
    )
  `);
  databases.set(file, db);
  return db;
}

export function closeRoomStores(): void {
  for (const db of databases.values()) db.close();
  databases.clear();
}

export function saveRoom(stateDir: string, room: StoredRoom): void {
  database(stateDir)
    .prepare(
      `INSERT INTO room_sessions (id, session_key, title, humans, members, messages, routed_turns, stopped)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         humans = excluded.humans,
         members = excluded.members,
         messages = excluded.messages,
         routed_turns = excluded.routed_turns,
         stopped = excluded.stopped`,
    )
    .run(
      room.id,
      room.sessionKey,
      room.title,
      JSON.stringify(room.humans),
      JSON.stringify(room.members),
      JSON.stringify(room.messages),
      room.routedTurns,
      room.stopped ?? null,
    );
}

export function loadRooms(stateDir: string): StoredRoom[] {
  const rows = database(stateDir)
    .prepare(
      "SELECT id, session_key, title, humans, members, messages, routed_turns, stopped FROM room_sessions ORDER BY id",
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    sessionKey: String(row.session_key),
    title: String(row.title),
    humans: JSON.parse(String(row.humans)) as string[],
    members: JSON.parse(String(row.members)) as RoomMember[],
    messages: JSON.parse(String(row.messages)) as StoredMessage[],
    routedTurns: Number(row.routed_turns),
    ...(typeof row.stopped === "string" ? { stopped: row.stopped } : {}),
  }));
}
