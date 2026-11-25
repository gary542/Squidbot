// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: the gateway side of a phone chat. It runs an agent turn and streams ciphertext chunks.

import { mkdtempSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { evaluateRunAdmission } from "../gate.js";
import { phoneMaterial } from "./client.js";
import { readFrame, writeFrame, type PhoneRelay } from "./listener.js";
import { TRANSPORT_RELAY, computerAccept, type KeyPair, type SessionKeys } from "./noise.js";
import { loadPhoneChat, PHONE_MAX_TURNS, savePhoneChat, type PhoneTranscriptLine } from "./phone-session.js";
import { phoneChunkFrame, phoneDoneFrame, phoneErrorFrame, runPhoneAgentTurn } from "./phone-turn.js";

export type PhoneTurnRunner = (input: {
  agentId: string;
  sessionKey: string;
  message: string;
  history: readonly PhoneTranscriptLine[];
  onChunk: (text: string) => Promise<void> | void;
}) => Promise<void>;

export async function attachComputerPeer(input: {
  relay: PhoneRelay;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  agentId?: string;
  runner?: PhoneTurnRunner;
}): Promise<{ close(): void }> {
  const socket = connect({ host: "127.0.0.1", port: input.relay.port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  writeFrame(socket, { type: "computer" });
  const ready = await readFrame(socket);
  if (ready.type !== "ready") throw new Error("computer peer was not accepted");
  const stateDir = input.stateDir ?? mkdtempSync(path.join(tmpdir(), "squidbot-phone-"));
  const env = input.env ?? process.env;
  const runner = input.runner ?? runPhoneAgentTurn;
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const frame = await readFrame(socket);
      if (frame.type !== "splice") continue;
      const accepted = await acceptChat(socket, input.relay.staticKey, input.relay.phoneKeys());
      if (!accepted) continue;
      await chat(socket, accepted, { stateDir, env, agentId: input.agentId, runner, stopped: () => stopped });
    }
  })().catch(() => undefined);
  return {
    close() {
      stopped = true;
      socket.destroy();
      void loop;
    },
  };
}

async function chat(
  socket: Socket,
  accepted: { id: string; keys: SessionKeys },
  input: {
    stateDir: string;
    env: NodeJS.ProcessEnv;
    agentId?: string;
    runner: PhoneTurnRunner;
    stopped: () => boolean;
  },
): Promise<void> {
  const chosen = input.agentId?.trim() || input.env.SQUIDBOT_PHONE_AGENT?.trim() || "main";
  while (!input.stopped()) {
    const record = await readSized(socket);
    if (isUnsplice(record)) return;
    const text = accepted.keys.receive.open(record).toString("utf8");
    const chatState = loadPhoneChat(input.stateDir, accepted.id, chosen);
    if (chatState.turns >= PHONE_MAX_TURNS) {
      writeSealed(socket, accepted.keys, phoneErrorFrame("loop"));
      continue;
    }
    const held = evaluateRunAdmission({
      agentId: chatState.agentId,
      trigger: "user",
      stateDir: input.stateDir,
      env: input.env,
    });
    if (held) {
      writeSealed(socket, accepted.keys, phoneErrorFrame(held.code));
      continue;
    }
    const history = chatState.messages;
    let reply = "";
    try {
      await input.runner({
        agentId: chatState.agentId,
        sessionKey: chatState.sessionKey,
        message: text,
        history,
        onChunk: async (chunk) => {
          reply += chunk;
          writeSealed(socket, accepted.keys, phoneChunkFrame(chunk));
        },
      });
    } catch {
      writeSealed(socket, accepted.keys, phoneErrorFrame("failed"));
      continue;
    }
    writeSealed(socket, accepted.keys, phoneDoneFrame());
    savePhoneChat(input.stateDir, {
      ...chatState,
      messages: [...history, { role: "user", text }, { role: "assistant", text: reply }],
      turns: chatState.turns + 1,
    });
  }
}

function isUnsplice(bytes: Buffer): boolean {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "unsplice");
  } catch {
    return false;
  }
}

function writeSealed(socket: Socket, keys: SessionKeys, value: unknown): void {
  writeSized(socket, keys.send.seal(Buffer.from(JSON.stringify(value))));
}

async function acceptChat(
  socket: Socket,
  staticKey: KeyPair,
  candidates: ReadonlyArray<{ id: string; psk: Buffer }>,
): Promise<{ id: string; keys: SessionKeys } | null> {
  const message1 = await readSized(socket);
  if (isUnsplice(message1)) return null;
  const accepted = computerAccept(
    {
      staticKey,
      transport: TRANSPORT_RELAY,
      candidates,
    },
    message1,
  );
  if (!accepted) return null;
  writeSized(socket, accepted.message2);
  return { id: accepted.id, keys: accepted.keys };
}

function writeSized(socket: Socket, bytes: Buffer): void {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  socket.write(Buffer.concat([header, bytes]));
}

function readSized(socket: Socket): Promise<Buffer> {
  socket.pause();
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const length = buf.readUInt32BE(0);
      if (buf.length < 4 + length) return;
      socket.pause();
      socket.off("data", onData);
      const body = buf.subarray(4, 4 + length);
      const rest = buf.subarray(4 + length);
      if (rest.length > 0) socket.unshift(rest);
      resolve(Buffer.from(body));
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.resume();
  });
}

export { phoneMaterial };
