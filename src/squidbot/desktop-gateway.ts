// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/container-computer.ts, server/vps-computer.ts, server/computer-control.ts @ 96ff8445.
// Modified: per-agent Podman and SSH desktop plans plus a viewer lease. Commands are built here and not launched.

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

export function resetDesktopGateway(): void {
  snapshot = { enabled: false, probes: [] };
  leases.clear();
  specs.clear();
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
