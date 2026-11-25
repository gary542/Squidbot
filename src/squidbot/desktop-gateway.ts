// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/container-computer.ts, server/vps-computer.ts, server/computer-control.ts @ 96ff8445.
// Modified: start and stop Podman or SSH desktops, and expose the viewer lease.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TakeControlLease, desktopsEnabled, pickComputer, type DesktopPlace } from "./desktops.js";
import { RfbClientFilter } from "./rfb-filter.js";
import { squidbotStateDir } from "./state-dir.js";

export type DesktopBackend = "podman" | "ssh";

export interface AgentDesktopSpec {
  backend: DesktopBackend;
  image?: string;
  sshTarget?: string;
}

export interface DesktopProbe {
  agentId: string;
  backend: DesktopBackend;
  ready: boolean;
  reason: string;
  argv: string[];
}

interface Snapshot {
  enabled: boolean;
  probes: DesktopProbe[];
}

let snapshot: Snapshot = { enabled: false, probes: [] };
const leases = new Map<string, TakeControlLease>();
const specs = new Map<string, AgentDesktopSpec>();

const running = new Map<string, { id: string; backend: DesktopBackend }>();

export type DesktopCommandResult = { code: number; stdout: string; stderr: string };
export type DesktopCommandRunner = (argv: string[]) => Promise<DesktopCommandResult>;

async function spawnCommand(argv: string[]): Promise<DesktopCommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => resolve({ code: 1, stdout: "", stderr: error.message }));
    child.on("close", (code) => resolve({
      code: code ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

let commandRunner: DesktopCommandRunner = spawnCommand;

export function setDesktopCommandRunner(next?: DesktopCommandRunner): void {
  commandRunner = next ?? spawnCommand;
}

export function resetDesktopGateway(): void {
  snapshot = { enabled: false, probes: [] };
  leases.clear();
  specs.clear();
  running.clear();
  commandRunner = spawnCommand;
}

export function bindAgentDesktop(agentId: string, spec: AgentDesktopSpec): void {
  specs.set(agentId, spec);
}

function loadSpecs(env: NodeJS.ProcessEnv): Map<string, AgentDesktopSpec> {
  const loaded = new Map(specs);
  const inline = env.SQUIDBOT_DESKTOPS_JSON?.trim();
  const file = path.join(squidbotStateDir(env), "squidbot", "desktops.json");
  const raw = inline || (existsSync(file) ? readFileSync(file, "utf8") : "");
  if (!raw) return loaded;
  try {
    const parsed = JSON.parse(raw) as { agents?: Record<string, AgentDesktopSpec> };
    for (const [agentId, spec] of Object.entries(parsed.agents ?? {})) {
      if (spec?.backend === "podman" || spec?.backend === "ssh") loaded.set(agentId, spec);
    }
  } catch {
    // A bad config leaves the in-memory bindings and reports no file agents.
  }
  return loaded;
}

function binary(env: NodeJS.ProcessEnv, name: string, override?: string): string | null {
  if (override) return existsSync(override) ? override : null;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function desktopArgv(spec: AgentDesktopSpec, env: NodeJS.ProcessEnv = process.env): { argv: string[]; ready: boolean; reason: string } {
  if (spec.backend === "podman") {
    const podman = binary(env, "podman", env.SQUIDBOT_PODMAN_PATH);
    const image = spec.image ?? "localhost/squidbot/cua-local";
    const argv = podman ? [podman, "run", "--rm", "-d", "--name", "squidbot-desktop", "-p", "127.0.0.1::5900", image] : [];
    return { argv, ready: Boolean(podman), reason: podman ? "podman" : "podman is not installed" };
  }
  const ssh = binary(env, "ssh", env.SQUIDBOT_SSH_PATH);
  if (!spec.sshTarget) return { argv: [], ready: false, reason: "ssh desktop needs sshTarget" };
  const argv = ssh ? [ssh, "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", spec.sshTarget, "podman", "info"] : [];
  return { argv, ready: Boolean(ssh), reason: ssh ? "ssh" : "ssh is not installed" };
}

export function probeAgentDesktops(env: NodeJS.ProcessEnv = process.env): DesktopProbe[] {
  if (!desktopsEnabled(env)) return [];
  return [...loadSpecs(env).entries()].map(([agentId, spec]) => {
    const probed = desktopArgv(spec, env);
    return { agentId, backend: spec.backend, ...probed };
  });
}

/** Called from the gateway computer service. No-op unless SQUIDBOT_DESKTOPS=1. */
export function observeSquidbotDesktops(env: NodeJS.ProcessEnv = process.env): Snapshot {
  if (!desktopsEnabled(env)) {
    snapshot = { enabled: false, probes: [] };
    return snapshot;
  }
  snapshot = { enabled: true, probes: probeAgentDesktops(env) };
  return snapshot;
}

export function readSquidbotDesktopSnapshot(): Snapshot {
  return snapshot;
}

export function leaseFor(agentId: string): TakeControlLease {
  const existing = leases.get(agentId);
  if (existing) return existing;
  const created = new TakeControlLease();
  leases.set(agentId, created);
  return created;
}

export function openDesktopViewer(agentId: string): { lease: TakeControlLease; filter: RfbClientFilter } {
  const lease = leaseFor(agentId);
  return { lease, filter: new RfbClientFilter({ allowInput: () => lease.viewerMayInput() }) };
}

export function chooseDesktop(input: { requested?: DesktopPlace; current?: DesktopPlace; ready: readonly DesktopPlace[] }) {
  return pickComputer(input);
}

export function startArgv(spec: AgentDesktopSpec, agentId: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const name = `squidbot-${agentId}`;
  const image = spec.image ?? "localhost/squidbot/cua-local";
  const run = ["run", "--rm", "-d", "--name", name, "-p", "127.0.0.1::5900", image];
  if (spec.backend === "podman") {
    const podman = binary(env, "podman", env.SQUIDBOT_PODMAN_PATH);
    return podman ? [podman, ...run] : [];
  }
  const ssh = binary(env, "ssh", env.SQUIDBOT_SSH_PATH);
  if (!ssh || !spec.sshTarget) return [];
  return [ssh, "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", spec.sshTarget, "podman", ...run];
}

export function stopArgv(spec: AgentDesktopSpec, containerId: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (spec.backend === "podman") {
    const podman = binary(env, "podman", env.SQUIDBOT_PODMAN_PATH);
    return podman ? [podman, "stop", containerId] : [];
  }
  const ssh = binary(env, "ssh", env.SQUIDBOT_SSH_PATH);
  if (!ssh || !spec.sshTarget) return [];
  return [ssh, "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", spec.sshTarget, "podman", "stop", containerId];
}

export interface DesktopSession {
  agentId: string;
  running: boolean;
  reason: string;
  containerId?: string;
  personHolds: boolean;
}

export async function startAgentDesktop(agentId: string, env: NodeJS.ProcessEnv = process.env): Promise<DesktopSession> {
  if (!desktopsEnabled(env)) return { agentId, running: false, reason: "off", personHolds: false };
  const spec = loadSpecs(env).get(agentId);
  if (!spec) return { agentId, running: false, reason: "unbound", personHolds: leaseFor(agentId).personHolds() };
  const argv = startArgv(spec, agentId, env);
  if (argv.length === 0) return { agentId, running: false, reason: "desktop binary is not installed", personHolds: false };
  const result = await commandRunner(argv);
  if (result.code !== 0) {
    return { agentId, running: false, reason: result.stderr.trim() || "start failed", personHolds: false };
  }
  const containerId = result.stdout.trim() || `squidbot-${agentId}`;
  running.set(agentId, { id: containerId, backend: spec.backend });
  return { agentId, running: true, reason: "started", containerId, personHolds: leaseFor(agentId).personHolds() };
}

export async function stopAgentDesktop(agentId: string, env: NodeJS.ProcessEnv = process.env): Promise<DesktopSession> {
  const current = running.get(agentId);
  const spec = loadSpecs(env).get(agentId);
  if (!current || !spec) return { agentId, running: false, reason: "not running", personHolds: leaseFor(agentId).personHolds() };
  const argv = stopArgv(spec, current.id, env);
  if (argv.length > 0) await commandRunner(argv);
  running.delete(agentId);
  return { agentId, running: false, reason: "stopped", personHolds: leaseFor(agentId).personHolds() };
}

export function listDesktopSessions(env: NodeJS.ProcessEnv = process.env): DesktopSession[] {
  if (!desktopsEnabled(env)) return [];
  return [...loadSpecs(env).keys()].map((agentId) => {
    const current = running.get(agentId);
    return {
      agentId,
      running: Boolean(current),
      reason: current ? "started" : "stopped",
      ...(current ? { containerId: current.id } : {}),
      personHolds: leaseFor(agentId).personHolds(),
    };
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderDesktopViewer(session: DesktopSession): string {
  const lease = session.personHolds ? "person" : "bot";
  return `<section class="squidbot-desktop" data-agent="${escapeHtml(session.agentId)}" data-running="${session.running}" data-lease="${lease}"><h2>${escapeHtml(session.agentId)}</h2><p>${escapeHtml(session.reason)}</p><canvas class="squidbot-desktop-viewer"></canvas></section>`;
}
