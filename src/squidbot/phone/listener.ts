// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: relay/src/splice.ts @ 96ff8445.
// Modified: a loopback listener. It splices ciphertext and closes 4404 when the phone is not admitted.

import { createServer, type Server, type Socket } from "node:net";
import { credentialHash, keyId, psk } from "./credentials.js";
import { generateKeyPair, type KeyPair } from "./noise.js";
import { PairingTable, type PairingCode, type PairedDevice } from "./pairing.js";
import { RELAY_ABSENT, relayPhoneDecision } from "./relay.js";

export const RELAY_RATE_LIMITED = 4429;
const WINDOW_MS = 60_000;

export function writeFrame(socket: Socket, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  socket.write(Buffer.concat([header, body]));
}

export function readFrame(socket: Socket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const fail = (error: Error) => {
      socket.off("data", onData);
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const length = buf.readUInt32BE(0);
      if (length > 65_536) return fail(new Error("frame too large"));
      if (buf.length < 4 + length) return;
      const body = buf.subarray(4, 4 + length);
      const rest = buf.subarray(4 + length);
      socket.off("data", onData);
      socket.pause();
      if (rest.length > 0) socket.unshift(rest);
      try {
        const parsed: unknown = JSON.parse(body.toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          fail(new Error("frame json"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("frame json"));
      }
    };
    socket.on("data", onData);
    socket.once("error", fail);
    socket.once("close", () => fail(new Error("socket closed")));
    socket.resume();
  });
}

export interface PhoneRelay {
  port: number;
  hostId: Buffer;
  staticKey: KeyPair;
  close(): Promise<void>;
  splicedBytes(): Buffer;
  issuePairing(now?: number): PairingCode;
  claim(code: string, now?: number): PairedDevice | null;
  revoke(deviceId: string): boolean;
  phoneKeys(): ReadonlyArray<{ id: string; psk: Buffer }>;
}

export async function startPhoneRelay(options: { port?: number; maxAttempts?: number } = {}): Promise<PhoneRelay> {
  const pairing = new PairingTable();
  const hostId = Buffer.alloc(16, 3);
  const staticKey = generateKeyPair();
  const forwarded: Buffer[] = [];
  const phoneKeys: Array<{ id: string; psk: Buffer }> = [];
  const attempts = new Map<string, number[]>();
  const maxAttempts = options.maxAttempts ?? 30;
  let computer: Socket | undefined;
  let online = false;
  let spliced = false;

  const allow = (ip: string, now: number) => {
    const recent = (attempts.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
    recent.push(now);
    attempts.set(ip, recent);
    return recent.length <= maxAttempts;
  };

  const server: Server = createServer((socket) => {
    const ip = socket.remoteAddress ?? "unknown";
    void (async () => {
      if (!allow(ip, Date.now())) {
        const body = Buffer.from(JSON.stringify({ type: "close", code: RELAY_RATE_LIMITED }));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(body.length);
        socket.end(Buffer.concat([header, body]));
        return;
      }
      const first = await readFrame(socket);
      if (first.type === "computer") {
        computer = socket;
        online = true;
        writeFrame(socket, { type: "ready", hostId: hostId.toString("base64url") });
        socket.on("close", () => {
          if (computer === socket) {
            computer = undefined;
            online = false;
            spliced = false;
          }
        });
        return;
      }
      if (first.type === "claim" && typeof first.code === "string") {
        const paired = pairing.claim(first.code, hostId);
        if (!paired) {
          writeFrame(socket, { type: "close", code: RELAY_ABSENT });
          socket.end();
          return;
        }
        phoneKeys.push({ id: paired.id, psk: psk(credentialHash(paired.token), keyId(staticKey.publicKey)) });
        writeFrame(socket, {
          type: "paired",
          deviceId: paired.id,
          token: paired.token,
          computerPublicKey: staticKey.publicKey.toString("base64url"),
          hostId: hostId.toString("base64url"),
          admissionHash: paired.admissionHash,
        });
        socket.end();
        return;
      }
      if (first.type === "revoke" && typeof first.deviceId === "string") {
        const revoked = pairing.revoke(first.deviceId);
        writeFrame(socket, revoked ? { type: "revoked", deviceId: first.deviceId } : { type: "close", code: RELAY_ABSENT });
        socket.end();
        return;
      }
      if (first.type !== "phone" || typeof first.hash !== "string") {
        writeFrame(socket, { type: "close", code: RELAY_ABSENT });
        socket.end();
        return;
      }
      const decision = relayPhoneDecision(
        online && !spliced ? { online: true, admissionHashes: pairing.admittedHashes() } : undefined,
        first.hash,
      );
      if (!("splice" in decision) || !computer) {
        writeFrame(socket, { type: "close", code: RELAY_ABSENT });
        socket.end();
        return;
      }
      const host = computer;
      spliced = true;
      writeFrame(socket, { type: "splice" });
      writeFrame(host, { type: "splice" });
      const forward = (from: Socket, to: Socket) => {
        from.on("data", (chunk: Buffer) => {
          forwarded.push(Buffer.from(chunk));
          to.write(chunk);
        });
      };
      forward(socket, host);
      forward(host, socket);
      const unsplice = () => {
        spliced = false;
      };
      socket.on("close", unsplice);
      host.on("close", unsplice);
      socket.resume();
      host.resume();
    })().catch(() => {
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("phone relay did not bind");

  return {
    port: address.port,
    hostId,
    staticKey,
    splicedBytes: () => Buffer.concat(forwarded),
    issuePairing: (now) => pairing.issue(now),
    claim: (code, now) => pairing.claim(code, hostId, now),
    revoke: (id) => {
      const removed = pairing.revoke(id);
      if (removed) {
        const index = phoneKeys.findIndex((entry) => entry.id === id);
        if (index >= 0) phoneKeys.splice(index, 1);
      }
      return removed;
    },
    phoneKeys: () => phoneKeys,
    close: () =>
      new Promise((resolve) => {
        computer?.destroy();
        server.close(() => resolve());
      }),
  };
}
