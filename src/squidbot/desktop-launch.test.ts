// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: start and stop tests for Podman and SSH desktops, plus the viewer lease.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  bindAgentDesktop,
  listDesktopSessions,
  openDesktopViewer,
  renderDesktopViewer,
  resetDesktopGateway,
  setDesktopCommandRunner,
  startAgentDesktop,
  stopAgentDesktop,
  type DesktopCommandResult,
} from "./desktop-gateway.js";

describe("desktop launch", () => {
  it("starts and stops a Podman desktop and gates the viewer", async () => {
    resetDesktopGateway();
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-desk-run-"));
    const podman = path.join(dir, "podman");
    writeFileSync(podman, "");
    const env = { SQUIDBOT_DESKTOPS: "1", SQUIDBOT_PODMAN_PATH: podman };
    bindAgentDesktop("ada", { backend: "podman", image: "localhost/squidbot/cua" });
    const commands: string[][] = [];
    setDesktopCommandRunner(async (argv) => {
      commands.push(argv);
      const result: DesktopCommandResult = argv.includes("stop")
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 0, stdout: "container-ada\n", stderr: "" };
      return result;
    });
    const started = await startAgentDesktop("ada", env);
    assert.equal(started.running, true);
    assert.equal(started.containerId, "container-ada");
    assert.deepEqual(commands[0]?.slice(1, 4), ["run", "--rm", "-d"]);
    const viewer = openDesktopViewer("ada");
    viewer.filter.feed(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]));
    const key = Buffer.alloc(8);
    key[0] = 4;
    key[1] = 1;
    key.writeUInt32BE(0x61, 4);
    assert.equal(viewer.filter.feed(key).length, 0);
    assert.match(renderDesktopViewer(started), /data-lease="bot"/);
    viewer.lease.take();
    assert.equal(viewer.filter.feed(key)[0], 4);
    assert.match(renderDesktopViewer({ ...started, personHolds: true }), /data-lease="person"/);
    const stopped = await stopAgentDesktop("ada", env);
    assert.equal(stopped.running, false);
    assert.equal(commands[1]?.includes("stop"), true);
    assert.equal(commands[1]?.includes("container-ada"), true);
    assert.equal(listDesktopSessions(env)[0]?.running, false);
    assert.equal((await startAgentDesktop("ada", {})).reason, "off");
    resetDesktopGateway();
  });

  it("starts an SSH desktop on the remote podman", async () => {
    resetDesktopGateway();
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-desk-ssh-"));
    const ssh = path.join(dir, "ssh");
    writeFileSync(ssh, "");
    const env = { SQUIDBOT_DESKTOPS: "1", SQUIDBOT_SSH_PATH: ssh };
    bindAgentDesktop("grace", { backend: "ssh", sshTarget: "gary@desktop", image: "localhost/squidbot/cua" });
    let argv: string[] = [];
    setDesktopCommandRunner(async (command) => {
      argv = command;
      return { code: 0, stdout: "remote-id\n", stderr: "" };
    });
    const started = await startAgentDesktop("grace", env);
    assert.equal(started.running, true);
    assert.equal(argv.includes("gary@desktop"), true);
    assert.equal(argv.includes("podman"), true);
    assert.equal(argv.includes("run"), true);
    resetDesktopGateway();
  });
});
