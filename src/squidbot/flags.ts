// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: phase flags for features that are not wired through every gateway surface yet.

export interface PhaseFlag {
  phase: 2 | 3 | 4;
  env: string;
  summary: string;
}

export const PHASE_FLAGS: readonly PhaseFlag[] = [
  { phase: 2, env: "SQUIDBOT_BOT_BOX", summary: "bubblewrap plan and credential broker for boxed turns" },
  { phase: 2, env: "SQUIDBOT_DESKTOPS", summary: "per-agent desktop providers (container, SSH, host)" },
  { phase: 3, env: "SQUIDBOT_ROOMS", summary: "multi-agent rooms and the assignment runtime in the session controller" },
  { phase: 4, env: "SQUIDBOT_PHONE_RELAY", summary: "Noise phone link and the blind relay listener" },
];

export function flagEnabled(envName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env[envName] === "1";
}
