// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: gateway wiring tests for boxed exec and per-agent desktops.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { authorizeBrokerCall } from "./broker.js";
import { prepareBoxedExec, resetBroker } from "./boxed-exec.js";
import { stopBroker } from "./broker-server.js";
import {
  bindAgentDesktop,
  desktopArgv,
  observeSquidbotDesktops,
  openDesktopViewer,
  resetDesktopGateway,
} from "./desktop-gateway.js";

const realKey = "sk-ant-api03-supersecretvalue";

describe("gateway phase 2 wiring", () => {
  it("leaves exec alone when the box flag is off", async () => {
    const result = await prepareBoxedExec({ command: "echo hi", env: {} });
    assert.equal(result.action, "skip");
  });

  it("wraps exec in bwrap and keeps the provider key out of the child", async () => {
    resetBroker();
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-bwrap-"));
    const bwrap = path.join(dir, "bwrap");
    writeFileSync(bwrap, "");
    const result = await prepareBoxedExec({
      command: "echo hi",
      agentId: "ada",
      sessionKey: "sess",
      workspace: "/tmp",
      bwrapPath: bwrap,
      brokerBase: "http://127.0.0.1:9",
      env: { SQUIDBOT_BOT_BOX: "1", ANTHROPIC_API_KEY: realKey, PATH: "/usr/bin" },
    });
    assert.equal(result.action, "apply");
    if (result.action !== "apply") return;
    assert.equal(result.mode, "bwrap");
    assert.match(result.command, /--clearenv/);
    assert.match(result.command, /bash -lc/);
    assert.equal(result.env.ANTHROPIC_API_KEY.startsWith("sqd_t0_"), true);
    assert.equal(JSON.stringify(result.env).includes(realKey), false);
    assert.equal(authorizeBrokerCall({ token: "sqd_t0_wrong", grant: "anthropic" }).status, 401);
    const forwarded = authorizeBrokerCall({
      token: result.token,
      grant: "anthropic",
      clientHeaders: { authorization: "Bearer stolen" },
    });
    assert.equal(forwarded.status, 200);
    assert.equal(forwarded.headers?.authorization, undefined);
    assert.equal(forwarded.headers?.["x-api-key"], realKey);
  });

  it("falls back to a token-only environment when bwrap is missing", async () => {
    resetBroker();
    const result = await prepareBoxedExec({
      command: "echo hi",
      brokerBase: "http://127.0.0.1:9",
      bwrapPath: "/no/such/bwrap",
      env: { SQUIDBOT_BOT_BOX: "1", OPENAI_API_KEY: "sk-openai-secret-value-123456" },
    });
    assert.equal(result.action, "apply");
    if (result.action !== "apply") return;
    assert.equal(result.mode, "host-broker");
    assert.equal(result.command, "echo hi");
    assert.equal(result.env.OPENAI_API_KEY?.includes("sk-openai"), false);
    assert.match(result.reason, /bwrap/);
  });

  it("plans Podman and SSH desktops and gates viewer input with the take-control lease", () => {
    resetDesktopGateway();
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-desk-"));
    const podman = path.join(dir, "podman");
    const ssh = path.join(dir, "ssh");
    writeFileSync(podman, "");
    writeFileSync(ssh, "");
    const env = { SQUIDBOT_DESKTOPS: "1", SQUIDBOT_PODMAN_PATH: podman, SQUIDBOT_SSH_PATH: ssh };
    bindAgentDesktop("ada", { backend: "podman", image: "localhost/squidbot/cua" });
    bindAgentDesktop("grace", { backend: "ssh", sshTarget: "gary@desktop" });
    const snapshot = observeSquidbotDesktops(env);
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.probes.find((probe) => probe.agentId === "ada")?.ready, true);
    assert.deepEqual(snapshot.probes.find((probe) => probe.agentId === "ada")?.argv.slice(1, 3), ["run", "--rm"]);
    const sshPlan = desktopArgv({ backend: "ssh", sshTarget: "gary@desktop" }, env);
    assert.equal(sshPlan.argv.includes("gary@desktop"), true);
    assert.equal(sshPlan.argv.includes("BatchMode=yes"), true);
    const viewer = openDesktopViewer("ada");
    viewer.filter.feed(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]));
    const key = Buffer.alloc(8);
    key[0] = 4;
    key[1] = 1;
    key.writeUInt32BE(0x61, 4);
    assert.equal(viewer.filter.feed(key).length, 0);
    assert.equal(viewer.lease.botMayAct().allowed, true);
    viewer.lease.take();
    assert.equal(viewer.lease.botMayAct().allowed, false);
    const person = openDesktopViewer("ada");
    person.filter.feed(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]));
    assert.equal(person.filter.feed(key)[0], 4);
    assert.equal(observeSquidbotDesktops({}).enabled, false);
  });
});

describe("broker loopback", () => {
  it("answers 401 for a bad token without forwarding", async () => {
    const { ensureBrokerBase } = await import("./broker-server.js");
    const base = await ensureBrokerBase();
    const response = await fetch(`${base}/b/sqd_t0_missing/anthropic/v1/messages`, {
      headers: { authorization: "Bearer stolen" },
    });
    assert.equal(response.status, 401);
    await stopBroker();
  });
});
