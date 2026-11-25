// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: the gateway side of a phone chat. The relay still only forwards ciphertext.

import { connect } from "node:net";
import { phoneMaterial } from "./client.js";
import { readFrame, writeFrame, type PhoneRelay } from "./listener.js";
import { TRANSPORT_RELAY, computerAccept, type KeyPair, type SessionKeys } from "./noise.js";

export async function attachComputerPeer(input: {
  relay: PhoneRelay;
  reply?: (text: string) => Promise<string> | string;
}): Promise<{ close(): void }> {
  const socket = connect({ host: "127.0.0.1", port: input.relay.port });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
  writeFrame(socket, { type: "computer" });
  const ready = await readFrame(socket);
  if (ready.type !== "ready") throw new Error("computer peer was not accepted");
  const reply = input.reply ?? ((text: string) => `Squidbot: ${text}`);
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const frame = await readFrame(socket);
      if (frame.type !== "splice") continue;
      const keys = await acceptChat(socket, input.relay.staticKey, input.relay.phoneKeys());
      if (!keys) continue;
      while (!stopped) {
        const record = await readSized(socket);
        const text = keys.receive.open(record).toString("utf8");
        const answer = await reply(text);
        writeSized(socket, keys.send.seal(Buffer.from(answer)));
      }
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

async function acceptChat(
  socket: import("node:net").Socket,
  staticKey: KeyPair,
  candidates: ReadonlyArray<{ id: string; psk: Buffer }>,
): Promise<SessionKeys | null> {
  const message1 = await readSized(socket);
  const accepted = computerAccept(
    {
      staticKey,
      transport: TRANSPORT_RELAY,
      candidates,
    },
    message1,
  );
  return accepted ? (writeSized(socket, accepted.message2), accepted.keys) : null;
}

function writeSized(socket: import("node:net").Socket, bytes: Buffer): void {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  socket.write(Buffer.concat([header, bytes]));
}

function readSized(socket: import("node:net").Socket): Promise<Buffer> {
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
