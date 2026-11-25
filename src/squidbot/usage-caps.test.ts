// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: tests for caps, pause, and the 409 admission gate.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { writeCapsConfig } from "./caps-config.js";
import { evaluateRunAdmission } from "./gate.js";
import { setPaused } from "./pause.js";
import { noteUsage } from "./usage-ledger.js";
import { capTokens, reachedCap } from "./usage-caps.js";

describe("usage caps and pause", () => {
  it("counts fresh input plus output and ignores cached input", () => {
    assert.equal(capTokens({ input: 100, output: 40, cachedInput: 25 }), 115);
  });

  it("refuses unattended work with 409 spend_cap and still admits a person when stops is unattended", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-caps-"));
    writeCapsConfig(dir, { stops: "unattended", server: { dailyTokens: 10 } });
    noteUsage(dir, { at: new Date().toISOString(), threadId: "t", botId: "main", costUsd: 0, input: 8, output: 4, cachedInput: 0 });
    const cron = evaluateRunAdmission({ agentId: "main", trigger: "cron", stateDir: dir, env: {} });
    assert.equal(cron?.status, 409);
    assert.equal(cron?.code, "spend_cap");
    const chat = evaluateRunAdmission({ agentId: "main", trigger: "user", stateDir: dir, env: {} });
    assert.equal(chat, null);
    const everything = reachedCap({ stops: "everything", server: { dailyTokens: 10 } }, dir, { botId: "main", personWaiting: true });
    assert.ok(everything?.reached);
  });

  it("skips a paused agent with 409 bot_held", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-pause-"));
    setPaused(dir, { kind: "bot", id: "researcher" }, true);
    const held = evaluateRunAdmission({ agentId: "researcher", trigger: "user", stateDir: dir, env: {} });
    assert.equal(held?.code, "bot_held");
    assert.match(held?.message ?? "", /paused/);
    const other = evaluateRunAdmission({ agentId: "main", trigger: "user", stateDir: dir, env: {} });
    assert.equal(other, null);
  });
});
