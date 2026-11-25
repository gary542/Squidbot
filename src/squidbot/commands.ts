// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: owner commands for caps, pause, team export, and flag-gated later phases.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writeCapsConfig, readCapsConfig } from "./caps-config.js";
import { projectApiKey, verdictForAgentCall, type ComposioSettings } from "./composio.js";
import { flagEnabled, PHASE_FLAGS } from "./flags.js";
import { evaluateRunAdmission } from "./gate.js";
import { setPaused } from "./pause.js";
import { planBwrap } from "./bwrap.js";
import { squidbotStateDir } from "./state-dir.js";
import { exportTeam, importTeamDocument, parseTeamMarkdown, createImportStore, readExportFolder, writeExportFolder } from "./team-package.js";
import { noteUsage } from "./usage-ledger.js";
import { capStates } from "./usage-caps.js";

function settingsFile(dataDir: string): string {
  return path.join(dataDir, "squidbot", "composio.json");
}

export function readComposioSettings(dataDir: string): ComposioSettings {
  try {
    return JSON.parse(readFileSync(settingsFile(dataDir), "utf8")) as ComposioSettings;
  } catch {
    return {};
  }
}

export function writeComposioSettings(dataDir: string, settings: ComposioSettings): void {
  mkdirSync(path.dirname(settingsFile(dataDir)), { recursive: true });
  writeFileSync(settingsFile(dataDir), `${JSON.stringify(settings, null, 2)}\n`);
}

export function pauseAgent(agentId: string, env: NodeJS.ProcessEnv = process.env) {
  return setPaused(squidbotStateDir(env), { kind: "bot", id: agentId }, true);
}

export function resumeAgent(agentId: string | undefined, all: boolean, env: NodeJS.ProcessEnv = process.env) {
  const dir = squidbotStateDir(env);
  if (all) return setPaused(dir, { kind: "all" }, false);
  if (!agentId) throw new Error("Name an agent to resume, or pass --all.");
  return setPaused(dir, { kind: "bot", id: agentId }, false);
}

export function usageReport(agentId: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  const dir = squidbotStateDir(env);
  const saved = readCapsConfig(dir);
  return {
    states: capStates(saved, dir, new Date(), env, agentId),
    admission: evaluateRunAdmission({ agentId, trigger: "cron", env, stateDir: dir }),
  };
}

export function recordUsage(input: { agentId: string; costUsd: number; input: number; output: number; cachedInput?: number }, env: NodeJS.ProcessEnv = process.env) {
  noteUsage(squidbotStateDir(env), {
    at: new Date().toISOString(),
    threadId: "cli",
    botId: input.agentId,
    costUsd: input.costUsd,
    input: input.input,
    output: input.output,
    cachedInput: input.cachedInput ?? 0,
  });
}

export function saveServerCap(field: "dailyUsd" | "monthlyUsd" | "dailyTokens" | "monthlyTokens", value: number, env: NodeJS.ProcessEnv = process.env) {
  const dir = squidbotStateDir(env);
  const saved = readCapsConfig(dir);
  writeCapsConfig(dir, { ...saved, server: { ...saved.server, [field]: value } });
}

export function exportTeamMarkdown(input: Parameters<typeof exportTeam>[0]): { markdown: string; redactions: number } {
  const result = exportTeam(input);
  return { markdown: result.markdown, redactions: result.redactions };
}

export function importTeamMarkdown(markdown: string) {
  const store = createImportStore();
  return importTeamDocument(store, parseTeamMarkdown(markdown));
}

export function checkComposioCall(agentId: string, frame: unknown, env: NodeJS.ProcessEnv = process.env) {
  const dir = squidbotStateDir(env);
  const settings = readComposioSettings(dir);
  const key = projectApiKey(settings, env);
  if (!key) return { configured: false, allowed: false, message: "No Composio project key. Set SQUIDBOT_COMPOSIO_API_KEY or squidbot composio key." };
  const verdict = verdictForAgentCall(settings, agentId, frame, false);
  return { configured: true, allowed: verdict.allowed, message: verdict.message };
}

export function phaseStatus(env: NodeJS.ProcessEnv = process.env) {
  return PHASE_FLAGS.map((flag) => ({
    phase: flag.phase,
    env: flag.env,
    enabled: flagEnabled(flag.env, env),
    summary: flag.summary,
  }));
}

export function boxPlan(workspace: string, command: string[], env: NodeJS.ProcessEnv = process.env) {
  return planBwrap({ workspace, command, env });
}

export { readExportFolder, writeExportFolder };
