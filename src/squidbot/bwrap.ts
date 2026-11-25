// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/bot-box/plan.ts @ 96ff8445.
// Modified: plans a bubblewrap argv. The sandbox runs only when SQUIDBOT_BOT_BOX=1 and bwrap exists.

import { existsSync } from "node:fs";

export function botBoxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SQUIDBOT_BOT_BOX === "1";
}

export interface BwrapPlan {
  enabled: boolean;
  reason: string;
  argv: string[];
}

export function planBwrap(input: {
  command: string[];
  workspace: string;
  env?: NodeJS.ProcessEnv;
  bwrapPath?: string;
}): BwrapPlan {
  const env = input.env ?? process.env;
  if (!botBoxEnabled(env)) {
    return { enabled: false, reason: "SQUIDBOT_BOT_BOX is not 1", argv: [] };
  }
  const bwrap = input.bwrapPath ?? "bwrap";
  if (input.bwrapPath && !existsSync(input.bwrapPath)) {
    return { enabled: false, reason: `bwrap not found at ${input.bwrapPath}`, argv: [] };
  }
  const argv = [
    bwrap,
    "--unshare-all",
    "--share-net",
    "--die-with-parent",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/etc", "/etc",
    "--proc", "/proc",
    "--dev", "/dev",
    "--bind", input.workspace, input.workspace,
    "--chdir", input.workspace,
    "--",
    ...input.command,
  ];
  return { enabled: true, reason: "planned", argv };
}
