// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: proves computer status observes Podman and SSH desktops without changing its result.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  bindAgentDesktop,
  readSquidbotDesktopSnapshot,
  resetDesktopGateway,
} from "../../squidbot/desktop-gateway.js";
import { createGatewayComputerService } from "./computer-service.js";

const previous = {
  flag: process.env.SQUIDBOT_DESKTOPS,
  podman: process.env.SQUIDBOT_PODMAN_PATH,
  ssh: process.env.SQUIDBOT_SSH_PATH,
};

afterEach(() => {
  if (previous.flag === undefined) delete process.env.SQUIDBOT_DESKTOPS;
  else process.env.SQUIDBOT_DESKTOPS = previous.flag;
  if (previous.podman === undefined) delete process.env.SQUIDBOT_PODMAN_PATH;
  else process.env.SQUIDBOT_PODMAN_PATH = previous.podman;
  if (previous.ssh === undefined) delete process.env.SQUIDBOT_SSH_PATH;
  else process.env.SQUIDBOT_SSH_PATH = previous.ssh;
  resetDesktopGateway();
});

describe("squidbot desktop gateway wiring", () => {
  it("records a ready Podman desktop while computer status stays unchanged", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-podman-"));
    const podman = path.join(dir, "podman");
    writeFileSync(podman, "");
    process.env.SQUIDBOT_DESKTOPS = "1";
    process.env.SQUIDBOT_PODMAN_PATH = podman;
    bindAgentDesktop("ada", { backend: "podman", image: "localhost/squidbot/cua" });
    const service = createGatewayComputerService({
      getConfig: () => ({}) as OpenClawConfig,
      getPluginRegistry: () => ({ plugins: [], nodeHostCommands: [] }) as never,
    });
    await expect(service.status({ probe: false })).resolves.toEqual({
      configured: false,
      available: false,
    });
    expect(readSquidbotDesktopSnapshot().probes).toEqual([
      expect.objectContaining({ agentId: "ada", backend: "podman", ready: true }),
    ]);
  });
});
