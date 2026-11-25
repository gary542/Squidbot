// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: proves the exec gateway path swaps keys when SQUIDBOT_BOT_BOX=1.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetBroker } from "../squidbot/boxed-exec.js";
import { stopBroker } from "../squidbot/broker-server.js";
import { createExecRequestPreparation } from "./bash-tools.exec-request-preparation.js";

const realKey = "sk-ant-api03-supersecretvalue";
const previous = {
  box: process.env.SQUIDBOT_BOT_BOX,
  bwrap: process.env.SQUIDBOT_BWRAP_PATH,
  key: process.env.ANTHROPIC_API_KEY,
};

afterEach(async () => {
  if (previous.box === undefined) delete process.env.SQUIDBOT_BOT_BOX;
  else process.env.SQUIDBOT_BOT_BOX = previous.box;
  if (previous.bwrap === undefined) delete process.env.SQUIDBOT_BWRAP_PATH;
  else process.env.SQUIDBOT_BWRAP_PATH = previous.bwrap;
  if (previous.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previous.key;
  resetBroker();
  await stopBroker();
});

describe("squidbot boxed exec gateway wiring", () => {
  it("rewrites the exec command and hides the provider key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-exec-"));
    const bwrap = path.join(dir, "bwrap");
    writeFileSync(bwrap, "");
    process.env.SQUIDBOT_BOT_BOX = "1";
    process.env.SQUIDBOT_BWRAP_PATH = bwrap;
    process.env.ANTHROPIC_API_KEY = realKey;
    const preparation = createExecRequestPreparation({
      agentId: "ada",
      resolveHostForParams: () => "gateway",
    });
    const args = { command: "echo hi" };
    await preparation.prepareParamsWithResolvedExecEnv(args, {
      hookContext: { agentId: "ada", sessionKey: "agent:ada:main" },
    });
    expect(args.command).toContain("--clearenv");
    expect(args.command).toContain(bwrap);
    const state = preparation.getResolvedExecEnvPreparedState(args);
    expect(state?.pluginEnv?.ANTHROPIC_API_KEY?.startsWith("sqd_t0_")).toBe(true);
    expect(JSON.stringify(state?.pluginEnv)).not.toContain(realKey);
  });
});
