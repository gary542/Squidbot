// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: phone chats run through a stub agent, stream chunks, and keep history.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { writeCapsConfig } from "./caps-config.js";
import { connectPhone, exchangeChat, phoneMaterial } from "./phone/client.js";
import { attachComputerPeer } from "./phone/computer-peer.js";
import { readFrame, startPhoneRelay, writeFrame } from "./phone/listener.js";
import { loadPhoneChat, PHONE_MAX_TURNS, savePhoneChat } from "./phone/phone-session.js";
import { friendlyPhoneError, runPhoneAgentTurn, streamText } from "./phone/phone-turn.js";
import { setPaused } from "./pause.js";
import { noteUsage } from "./usage-ledger.js";

async function claimCode(port: number, code: string): Promise<Record<string, unknown>> {
  const claim = connect({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    claim.once("connect", () => resolve());
    claim.once("error", reject);
  });
  writeFrame(claim, { type: "claim", code });
  const paired = await readFrame(claim);
  claim.end();
  return paired;
}

describe("phone agent turns", () => {
  it("streams a stub reply in chunks and keeps the session across a reconnect", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-phone-agent-"));
    const relay = await startPhoneRelay({ port: 0 });
    const seen: Array<{ sessionKey: string; message: string; history: string[] }> = [];
    const peer = await attachComputerPeer({
      relay,
      stateDir: dir,
      env: {},
      agentId: "researcher",
      runner: async ({ sessionKey, message, history, onChunk }) => {
        seen.push({ sessionKey, message, history: history.map((line) => line.text) });
        await onChunk("Hello ");
        await onChunk(message);
      },
    });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const issued = relay.issuePairing();
      const paired = await claimCode(relay.port, issued.code);
      const material = phoneMaterial(String(paired.token), relay.staticKey.publicKey, relay.hostId);
      const first = await connectPhone(relay.port, material.admissionHash);
      assert.ok("socket" in first);
      const answer = await exchangeChat({
        phone: first.socket,
        staticKey: relay.staticKey,
        psk: material.psk,
        text: "first question",
      });
      assert.equal(answer, "Hello first question");
      assert.equal(relay.splicedBytes().includes(Buffer.from("first question")), false);
      assert.equal(relay.splicedBytes().includes(Buffer.from("Hello ")), false);
      first.socket.end();
      await new Promise((resolve) => first.socket.once("close", resolve));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const second = await connectPhone(relay.port, material.admissionHash);
      assert.ok("socket" in second);
      const again = await exchangeChat({
        phone: second.socket,
        staticKey: relay.staticKey,
        psk: material.psk,
        text: "second question",
      });
      assert.equal(again, "Hello second question");
      assert.equal(seen.length, 2);
      assert.equal(seen[0]?.sessionKey, `phone:${String(paired.deviceId)}`);
      assert.equal(seen[1]?.sessionKey, seen[0]?.sessionKey);
      assert.deepEqual(seen[1]?.history, ["first question", "Hello first question"]);
      const stored = loadPhoneChat(dir, String(paired.deviceId), "researcher");
      assert.equal(stored.agentId, "researcher");
      assert.equal(stored.turns, 2);
      second.socket.end();
    } finally {
      peer.close();
      await relay.close();
    }
  });

  it("shows bot_held and spend_cap without calling the agent", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-phone-hold-"));
    setPaused(dir, { kind: "bot", id: "main" }, true);
    const relay = await startPhoneRelay({ port: 0 });
    let calls = 0;
    const peer = await attachComputerPeer({
      relay,
      stateDir: dir,
      env: {},
      runner: async () => {
        calls += 1;
      },
    });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const issued = relay.issuePairing();
      const paired = await claimCode(relay.port, issued.code);
      const material = phoneMaterial(String(paired.token), relay.staticKey.publicKey, relay.hostId);
      const phone = await connectPhone(relay.port, material.admissionHash);
      assert.ok("socket" in phone);
      await assert.rejects(
        () =>
          exchangeChat({
            phone: phone.socket,
            staticKey: relay.staticKey,
            psk: material.psk,
            text: "are you there",
          }),
        (error: unknown) => error instanceof Error && error.message === friendlyPhoneError("bot_held"),
      );
      assert.equal(calls, 0);
      phone.socket.end();
    } finally {
      peer.close();
      await relay.close();
    }

    const capped = mkdtempSync(path.join(tmpdir(), "squidbot-phone-cap-"));
    writeCapsConfig(capped, { stops: "everything", server: { dailyTokens: 10 } });
    noteUsage(capped, {
      at: new Date().toISOString(),
      threadId: "phone",
      botId: "main",
      costUsd: 0,
      input: 8,
      output: 4,
      cachedInput: 0,
    });
    const relay2 = await startPhoneRelay({ port: 0 });
    let cappedCalls = 0;
    const peer2 = await attachComputerPeer({
      relay: relay2,
      stateDir: capped,
      env: {},
      runner: async () => {
        cappedCalls += 1;
      },
    });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const issued = relay2.issuePairing();
      const paired = await claimCode(relay2.port, issued.code);
      const material = phoneMaterial(String(paired.token), relay2.staticKey.publicKey, relay2.hostId);
      const phone = await connectPhone(relay2.port, material.admissionHash);
      assert.ok("socket" in phone);
      await assert.rejects(
        () =>
          exchangeChat({
            phone: phone.socket,
            staticKey: relay2.staticKey,
            psk: material.psk,
            text: "spend",
          }),
        (error: unknown) => error instanceof Error && error.message === friendlyPhoneError("spend_cap"),
      );
      assert.equal(cappedCalls, 0);
      phone.socket.end();
    } finally {
      peer2.close();
      await relay2.close();
    }
  });

  it("stops a phone chat at 300 turns", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-phone-loop-"));
    const relay = await startPhoneRelay({ port: 0 });
    let calls = 0;
    const peer = await attachComputerPeer({
      relay,
      stateDir: dir,
      env: {},
      runner: async () => {
        calls += 1;
      },
    });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      const issued = relay.issuePairing();
      const paired = await claimCode(relay.port, issued.code);
      savePhoneChat(dir, {
        deviceId: String(paired.deviceId),
        agentId: "main",
        sessionKey: `phone:${String(paired.deviceId)}`,
        messages: [],
        turns: PHONE_MAX_TURNS,
      });
      const material = phoneMaterial(String(paired.token), relay.staticKey.publicKey, relay.hostId);
      const phone = await connectPhone(relay.port, material.admissionHash);
      assert.ok("socket" in phone);
      await assert.rejects(
        () =>
          exchangeChat({
            phone: phone.socket,
            staticKey: relay.staticKey,
            psk: material.psk,
            text: "again",
          }),
        (error: unknown) => error instanceof Error && error.message === friendlyPhoneError("loop"),
      );
      assert.equal(calls, 0);
      phone.socket.end();
    } finally {
      peer.close();
      await relay.close();
    }
  });

  it("asks the injected agent turn for the phone session and streams that text", async () => {
    const chunks: string[] = [];
    await runPhoneAgentTurn({
      agentId: "main",
      sessionKey: "phone:dev",
      message: "hi",
      history: [],
      onChunk: (text) => {
        chunks.push(text);
      },
      turn: async (input) => {
        assert.equal(input.agentId, "main");
        assert.equal(input.sessionKey, "phone:dev");
        assert.equal(input.message, "hi");
        return "hello from the agent";
      },
    });
    assert.equal(chunks.join(""), "hello from the agent");
  });

  it("splits an agent reply into 24-character chunks without a model call", async () => {
    const chunks: string[] = [];
    await streamText("abcdefghijklmnopqrstuvwxyz", 24, (text) => {
      chunks.push(text);
    });
    assert.deepEqual(chunks, ["abcdefghijklmnopqrstuvwx", "yz"]);
  });
});
