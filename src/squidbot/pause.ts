// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: docs/pausing-bots.md and the pause store described there @ 96ff8445.
// Modified: a JSON pause set in the Squidbot state dir. No hosted department admin.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface PauseState {
  all: boolean;
  agents: string[];
  /** Department id to member agent ids. Pausing a department pauses every member. */
  departments: Record<string, { paused: boolean; agents: string[] }>;
}

export function emptyPause(): PauseState {
  return { all: false, agents: [], departments: {} };
}

export function pauseFile(dataDir: string): string {
  return path.join(dataDir, "squidbot", "pause.json");
}

export function readPause(dataDir: string): PauseState {
  try {
    const value: unknown = JSON.parse(readFileSync(pauseFile(dataDir), "utf8"));
    if (!value || typeof value !== "object") return emptyPause();
    const row = value as Partial<PauseState>;
    return {
      all: row.all === true,
      agents: Array.isArray(row.agents) ? row.agents.filter((id): id is string => typeof id === "string") : [],
      departments:
        row.departments && typeof row.departments === "object" ? row.departments : {},
    };
  } catch {
    return emptyPause();
  }
}

export function writePause(dataDir: string, state: PauseState): void {
  const file = pauseFile(dataDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

export type PauseTarget = { kind: "bot" | "department" | "all"; id?: string };

export function setPaused(dataDir: string, target: PauseTarget, paused: boolean): PauseState {
  const state = readPause(dataDir);
  if (target.kind === "all") state.all = paused;
  else if (target.kind === "bot" && target.id) {
    const agents = new Set(state.agents);
    if (paused) agents.add(target.id);
    else agents.delete(target.id);
    state.agents = [...agents];
  } else if (target.kind === "department" && target.id) {
    const current = state.departments[target.id] ?? { paused: false, agents: [] };
    state.departments[target.id] = { ...current, paused };
  }
  writePause(dataDir, state);
  return state;
}

export function holdForAgent(dataDir: string, agentId: string | undefined): { code: "bot_held"; status: 409; message: string } | null {
  const state = readPause(dataDir);
  if (state.all) {
    return { status: 409, code: "bot_held", message: "Every agent is paused. Resume with `squidbot agents resume --all`." };
  }
  if (agentId && state.agents.includes(agentId)) {
    return { status: 409, code: "bot_held", message: `Agent ${agentId} is paused. Resume with \`squidbot agents resume ${agentId}\`.` };
  }
  if (agentId) {
    for (const [department, record] of Object.entries(state.departments)) {
      if (record?.paused && record.agents?.includes(agentId)) {
        return {
          status: 409,
          code: "bot_held",
          message: `Department ${department} is paused, so ${agentId} will not run. Resume that department before routing around it.`,
        };
      }
    }
  }
  return null;
}
