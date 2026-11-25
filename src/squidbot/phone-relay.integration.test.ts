// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: listening relay tests for handshake, pairing, 4404, revocation, tamper, and rate limit.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { connectComputer, connectPhone, deliverSealedMessage, exchangeChat, phoneMaterial } from "./phone/client.js";
import { attachComputerPeer } from "./phone/computer-peer.js";
import { startPhoneRelayFromEnv } from "./phone/gateway.js";
import { RELAY_RATE_LIMITED, readFrame, startPhoneRelay, writeFrame } from "./phone/listener.js";
import { NoiseError } from "./phone/noise.js";
import { RELAY_ABSENT } from "./phone/relay.js";
import { PAIRING_TTL_MS } from "./phone/pairing.js";
import { connect } from "node:net";

describe("phone relay listener", () => {
  it("handshakes through the relay without revealing plaintext", async () => {
    const relay = await startPhoneRelay({ port: 0 });
    try {
      const computer = await connectComputer(relay.port);
      const issued = relay.issuePairing();
      assert.match(issued.qr, /^squidbot-phone:/);
      const paired = relay.claim(issued.code);
      assert.ok(paired);
      const material = phoneMaterial(paired.token, relay.staticKey.publicKey, relay.hostId);
      const phone = await connectPhone(relay.port, material.admissionHash);
      assert.ok("socket" in phone);
      const splice = await readFrame(computer);
      assert.equal(splice.type, "splice");
      const text = "hello computer from the phone";
      const delivered = await deliverSealedMessage({
        computer,
        phone: phone.socket,
        staticKey: relay.staticKey,
        psk: material.psk,
        text,
      });
      assert.equal(delivered.receive.open(delivered.record).toString(), text);
      assert.equal(relay.splicedBytes().includes(Buffer.from(text)), false);
      computer.end();
      phone.socket.end();
    } finally {
      await relay.close();
    }
  });

  it("closes 4404 for an unknown phone and after revocation", async () => {
    const relay = await startPhoneRelay({ port: 0 });
    try {
      const computer = await connectComputer(relay.port);
      const missing = await connectPhone(relay.port, "not-a-real-hash");
      assert.deepEqual(missing, { code: RELAY_ABSENT });
      const issued = relay.issuePairing();
      assert.equal(relay.claim(issued.code, issued.expiresAt), null);
      const paired = relay.claim(issued.code, issued.expiresAt - PAIRING_TTL_MS);
      assert.ok(paired);
      const material = phoneMaterial(paired.token, relay.staticKey.publicKey, relay.hostId);
      const first = await connectPhone(relay.port, material.admissionHash);
      assert.ok("socket" in first);
      await readFrame(computer);
      first.socket.end();
      await new Promise((resolve) => first.socket.once("close", resolve));
      assert.equal(relay.revoke(paired.id), true);
      const revoked = await connectPhone(relay.port, material.admissionHash);
      assert.deepEqual(revoked, { code: RELAY_ABSENT });
      computer.end();
    } finally {
      await relay.close();
    }
  });

  it("rejects a tampered record and rate-limits connection attempts", async () => {
    const relay = await startPhoneRelay({ port: 0, maxAttempts: 2 });
    try {
      const computer = await connectComputer(relay.port);
      const paired = relay.claim(relay.issuePairing().code);
      assert.ok(paired);
      const material = phoneMaterial(paired.token, relay.staticKey.publicKey, relay.hostId);
      const phone = await connectPhone(relay.port, material.admissionHash);
      assert.ok("socket" in phone);
      await readFrame(computer);
      const delivered = await deliverSealedMessage({
        computer,
        phone: phone.socket,
        staticKey: relay.staticKey,
        psk: material.psk,
        text: "untampered",
      });
      const tampered = Buffer.from(delivered.record);
      tampered[0] ^= 0xff;
      assert.throws(() => delivered.receive.open(tampered), (error: unknown) => error instanceof NoiseError && error.reason === "aead");
      assert.equal(delivered.receive.open(delivered.record).toString(), "untampered");
      const extra = connect({ host: "127.0.0.1", port: relay.port });
      await new Promise<void>((resolve, reject) => {
        extra.once("connect", () => resolve());
        extra.once("error", reject);
      });
      const limited = await readFrame(extra);
      assert.equal(limited.code, RELAY_RATE_LIMITED);
      extra.end();
      computer.end();
      phone.socket.end();
    } finally {
      await relay.close();
    }
  });

  it("pairs over the relay, chats, and unpairs", async () => {
    const relay = await startPhoneRelay({ port: 0 });
    const peer = await attachComputerPeer({ relay });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const issued = relay.issuePairing();
      const claim = connect({ host: "127.0.0.1", port: relay.port });
      await new Promise<void>((resolve, reject) => {
        claim.once("connect", () => resolve());
        claim.once("error", reject);
      });
      writeFrame(claim, { type: "claim", code: issued.code });
      const paired = await readFrame(claim);
      claim.end();
      assert.equal(paired.type, "paired");
      assert.equal(typeof paired.token, "string");
      const material = phoneMaterial(String(paired.token), relay.staticKey.publicKey, relay.hostId);
      assert.equal(paired.admissionHash, material.admissionHash);
      const phone = await connectPhone(relay.port, material.admissionHash);
      assert.ok("socket" in phone);
      const answer = await exchangeChat({
        phone: phone.socket,
        staticKey: relay.staticKey,
        psk: material.psk,
        text: "hello squidbot",
      });
      assert.equal(answer, "Squidbot: hello squidbot");
      assert.equal(relay.splicedBytes().includes(Buffer.from("hello squidbot")), false);
      const revoke = connect({ host: "127.0.0.1", port: relay.port });
      await new Promise<void>((resolve, reject) => {
        revoke.once("connect", () => resolve());
        revoke.once("error", reject);
      });
      writeFrame(revoke, { type: "revoke", deviceId: paired.deviceId });
      const revoked = await readFrame(revoke);
      assert.equal(revoked.type, "revoked");
      revoke.end();
      phone.socket.end();
      const again = await connectPhone(relay.port, material.admissionHash);
      assert.deepEqual(again, { code: RELAY_ABSENT });
    } finally {
      peer.close();
      await relay.close();
    }
  });

  it("stays off unless SQUIDBOT_PHONE_RELAY=1", async () => {
    assert.equal(await startPhoneRelayFromEnv({}), null);
  });
});
