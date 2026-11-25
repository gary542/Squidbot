// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: the broker proxies upstream, including a streamed body, over HTTP and a unix socket.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { mintBrokerToken, resetBroker } from "./broker.js";
import { brokerSocketPath, ensureBrokerBase, requestBroker, stopBroker } from "./broker-server.js";
import { prepareBoxedExec } from "./boxed-exec.js";
import { seccompDeniesPtrace, seccompProfile } from "./seccomp.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("broker proxy", () => {
  it("swaps the token for the real key and streams the upstream body", async () => {
    resetBroker();
    let seen: string | undefined;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upstream = createServer((req, res) => {
      seen = req.headers.authorization;
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("one");
      void gate.then(() => res.end("two"));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("upstream");
    const minted = mintBrokerToken({
      agentId: "ada",
      conversationId: "room",
      grants: { openai: { upstream: `http://127.0.0.1:${address.port}`, headers: { authorization: "Bearer real-key" } } },
    });
    try {
      const base = await ensureBrokerBase();
      const response = await fetch(`${base}/b/${minted.token}/openai/v1/chat`, {
        method: "POST",
        headers: { authorization: "Bearer stolen", "content-type": "application/json" },
        body: "{\"ping\":true}",
      });
      const reader = response.body?.getReader();
      assert.ok(reader);
      const first = await reader.read();
      assert.equal(Buffer.from(first.value ?? []).toString(), "one");
      release?.();
      const second = await reader.read();
      assert.equal(Buffer.from(second.value ?? []).toString(), "two");
      assert.equal(seen, "Bearer real-key");
      const socket = brokerSocketPath();
      assert.ok(socket);
      const viaSocket = await requestBroker({
        socketPath: socket,
        path: `/b/${minted.token}/openai/v1/chat`,
        headers: { authorization: "Bearer stolen" },
        body: "{}",
      });
      assert.equal(viaSocket.status, 200, viaSocket.body);
      assert.equal(viaSocket.body, "onetwo");
    } finally {
      release?.();
      await stopBroker();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      resetBroker();
    }
  });

  it("puts seccomp and the broker socket on the bwrap command", async () => {
    assert.equal(seccompDeniesPtrace(seccompProfile()), true);
    resetBroker();
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-seccomp-"));
    const bwrap = path.join(dir, "bwrap");
    writeFileSync(bwrap, "");
    await ensureBrokerBase();
    try {
      const planned = await prepareBoxedExec({
        command: "echo hi",
        bwrapPath: bwrap,
        env: { SQUIDBOT_BOT_BOX: "1", OPENAI_API_KEY: "sk-openai-secret-value-123456" },
      });
      assert.equal(planned.action, "apply");
      if (planned.action !== "apply") return;
      assert.match(planned.command, /--seccomp 3/);
      assert.match(planned.command, /squidbot-seccomp\.bpf/);
      assert.match(planned.command, /--bind/);
      assert.ok(planned.env.SQUIDBOT_BROKER_SOCK);
      assert.equal(planned.env.OPENAI_API_KEY.includes("sk-openai"), false);
    } finally {
      await stopBroker();
      resetBroker();
    }
  });
});
