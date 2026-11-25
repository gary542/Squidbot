// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: broker self-check, egress, and git push guard tests.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizeBrokerCall, boxEnv, mintBrokerToken, resetBroker, selfCheckBroker } from "./broker.js";
import { egressDecision } from "./egress.js";
import { readCommandList, refusedCommands } from "./git-push-guard.js";
import { planBwrap } from "./bwrap.js";

describe("boxed turns", () => {
  it("keeps the real key out of the box and rejects a wrong token with 401", () => {
    resetBroker();
    const realKey = "sk-ant-api03-supersecretvalue";
    const minted = mintBrokerToken({
      agentId: "ada",
      conversationId: "c1",
      grants: { anthropic: { upstream: "https://api.anthropic.com", headers: { "x-api-key": realKey } } },
    });
    const environment = boxEnv({ PATH: "/usr/bin", ANTHROPIC_API_KEY: realKey }, minted.token, "http://127.0.0.1:18080");
    const check = selfCheckBroker({ realKey, boxEnvironment: environment, token: minted.token, grant: "anthropic" });
    assert.equal(check.keyAbsent, true);
    assert.equal(check.wrongTokenStatus, 401);
    assert.equal(check.goodStatus, 200);
    const forwarded = authorizeBrokerCall({
      token: minted.token,
      grant: "anthropic",
      clientHeaders: { authorization: "Bearer stolen", accept: "application/json" },
    });
    assert.equal(forwarded.headers?.["x-api-key"], realKey);
    assert.equal(forwarded.headers?.authorization, undefined);
    assert.equal(forwarded.upstream, "https://api.anthropic.com");
  });

  it("refuses loopback and metadata addresses and stays off unless the flag is set", () => {
    assert.equal(egressDecision(["127.0.0.1"]).allowed, false);
    assert.equal(egressDecision(["169.254.169.254"]).allowed, false);
    assert.equal(egressDecision(["8.8.8.8"]).allowed, true);
    assert.equal(planBwrap({ workspace: "/work", command: ["echo", "hi"], env: {} }).enabled, false);
    assert.equal(planBwrap({ workspace: "/work", command: ["echo", "hi"], env: { SQUIDBOT_BOT_BOX: "1" } }).enabled, true);
  });

  it("refuses deleting a ref and updating the default branch", () => {
    const refused = refusedCommands(
      [
        { old: "a".repeat(40), new: "b".repeat(40), ref: "refs/heads/main" },
        { old: "b".repeat(40), new: "0".repeat(40), ref: "refs/heads/feature" },
      ],
      "refs/heads/main",
    );
    assert.equal(refused.length, 2);
    const line = `${"c".repeat(40)} ${"d".repeat(40)} refs/heads/feature\n`;
    const body = Buffer.from(line);
    const pkt = Buffer.concat([
      Buffer.from((body.length + 4).toString(16).padStart(4, "0")),
      body,
      Buffer.from("0000"),
    ]);
    const parsed = readCommandList(pkt, true);
    assert.equal(parsed.state, "done");
  });
});
