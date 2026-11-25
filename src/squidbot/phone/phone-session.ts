// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: one sqlite row per paired phone so a reconnect keeps the same agent session.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PHONE_MAX_TURNS = 300;

export interface PhoneTranscriptLine {
  role: "user" | "assistant";
  text: string;
}

export interface PhoneChat {
  deviceId: string;
  agentId: string;
  sessionKey: string;
  messages: PhoneTranscriptLine[];
  turns: number;
}

const databases = new Map<string, DatabaseSync>();

export function phoneStorePath(stateDir: string): string {
  return path.join(stateDir, "squidbot", "phone.sqlite");
}

function database(stateDir: string): DatabaseSync {
  const file = phoneStorePath(stateDir);
  const cached = databases.get(file);
  if (cached) return cached;
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS phone_chats (
      device_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      messages TEXT NOT NULL,
      turns INTEGER NOT NULL
    )
  `);
  databases.set(file, db);
  return db;
}

export function phoneSessionKey(deviceId: string): string {
  return `phone:${deviceId}`;
}

export function loadPhoneChat(stateDir: string, deviceId: string, agentId: string): PhoneChat {
  const row = database(stateDir)
    .prepare("SELECT agent_id, session_key, messages, turns FROM phone_chats WHERE device_id = ?")
    .get(deviceId) as Record<string, unknown> | undefined;
  if (!row) {
    return { deviceId, agentId, sessionKey: phoneSessionKey(deviceId), messages: [], turns: 0 };
  }
  return {
    deviceId,
    agentId: String(row.agent_id),
    sessionKey: String(row.session_key),
    messages: JSON.parse(String(row.messages)) as PhoneTranscriptLine[],
    turns: Number(row.turns),
  };
}

export function savePhoneChat(stateDir: string, chat: PhoneChat): void {
  database(stateDir)
    .prepare(
      `INSERT INTO phone_chats (device_id, agent_id, session_key, messages, turns)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET
         agent_id = excluded.agent_id,
         session_key = excluded.session_key,
         messages = excluded.messages,
         turns = excluded.turns`,
    )
    .run(chat.deviceId, chat.agentId, chat.sessionKey, JSON.stringify(chat.messages), chat.turns);
}
