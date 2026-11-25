// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: the phone handshake in companion/src/e2e @ 96ff8445.
// Modified: a reference phone client. No mobile app and no hosted relay.

import { connect, type Socket } from "node:net";
import { admission, admissionHash, credentialHash, keyId, psk } from "./credentials.js";
import { readFrame, writeFrame, type PhoneRelay } from "./listener.js";
import {
  TRANSPORT_RELAY,
  computerAccept,
  encodePayload1,
  newConn,
  phoneHello,
  type KeyPair,
} from "./noise.js";
import { parsePhoneFrame } from "./phone-turn.js";

export function phoneMaterial(token: string, computerPublicKey: Uint8Array, hostId: Uint8Array) {
  const credHash = credentialHash(token);
  return {
    psk: psk(credHash, keyId(computerPublicKey)),
    admissionHash: admissionHash(admission(credHash, hostId)),
  };
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
}

export async function connectComputer(port: number): Promise<Socket> {
  const socket = connect({ host: "127.0.0.1", port });
  await waitForConnect(socket);
  writeFrame(socket, { type: "computer" });
  const ready = await readFrame(socket);
  if (ready.type !== "ready") throw new Error("computer was not accepted");
  return socket;
}

export async function connectPhone(port: number, hash: string): Promise<{ socket: Socket } | { code: number }> {
  const socket = connect({ host: "127.0.0.1", port });
  await waitForConnect(socket);
  writeFrame(socket, { type: "phone", hash });
  const reply = await readFrame(socket);
  if (reply.type === "close") {
    socket.end();
    return { code: typeof reply.code === "number" ? reply.code : 4404 };
  }
  if (reply.type !== "splice") {
    socket.end();
    return { code: 4404 };
  }
  return { socket };
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
      if (length > 65_536) {
        socket.off("data", onData);
        reject(new Error("frame too large"));
        return;
      }
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

/** One sealed line from the phone to the computer. The relay only forwards ciphertext. */
export async function deliverSealedMessage(input: {
  computer: Socket;
  phone: Socket;
  staticKey: KeyPair;
  psk: Buffer;
  text: string;
}): Promise<{ opened: string; sealed: Buffer }> {
  const conn = newConn();
  const hello = phoneHello(
    { remoteStatic: input.staticKey.publicKey, psk: input.psk, transport: TRANSPORT_RELAY },
    encodePayload1(conn, "phone"),
    conn.toString("base64url"),
  );
  writeSized(input.phone, hello.message1);
  const message1 = await readSized(input.computer);
  const accepted = computerAccept(
    { staticKey: input.staticKey, transport: TRANSPORT_RELAY, candidates: [{ id: "phone", psk: input.psk }] },
    message1,
  );
  if (!accepted) throw new Error("computer rejected the handshake");
  writeSized(input.computer, accepted.message2);
  const message2 = await readSized(input.phone);
  const phone = hello.finish(message2);
  const sealed = phone.send.seal(Buffer.from(input.text));
  writeSized(input.phone, sealed);
  const record = await readSized(input.computer);
  return { record, sealed, receive: accepted.keys.receive };
}

/** Phone-only chat through an already spliced socket. The computer peer answers on the other side. */
export async function exchangeChat(input: {
  phone: Socket;
  staticKey: KeyPair;
  psk: Buffer;
  text: string;
}): Promise<string> {
  const conn = newConn();
  const hello = phoneHello(
    { remoteStatic: input.staticKey.publicKey, psk: input.psk, transport: TRANSPORT_RELAY },
    encodePayload1(conn, "phone"),
    conn.toString("base64url"),
  );
  writeSized(input.phone, hello.message1);
  const message2 = await readSized(input.phone);
  const session = hello.finish(message2);
  writeSized(input.phone, session.send.seal(Buffer.from(input.text)));
  const parts: string[] = [];
  while (true) {
    const reply = await readSized(input.phone);
    const frame = parsePhoneFrame(session.receive.open(reply).toString("utf8"));
    if (!frame) throw new Error("phone frame");
    if (frame.kind === "chunk") {
      parts.push(frame.text);
      continue;
    }
    if (frame.kind === "done") return parts.join("");
    const error = new Error(frame.message);
    (error as Error & { code?: string }).code = frame.code;
    throw error;
  }
}
