// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: Squidbot state lives beside the gateway state, overridable with SQUIDBOT_STATE_DIR.

import os from "node:os";
import path from "node:path";

export function squidbotStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SQUIDBOT_STATE_DIR?.trim();
  if (explicit) return explicit;
  const gateway = env.OPENCLAW_STATE_DIR?.trim();
  if (gateway) return gateway;
  return path.join(os.homedir(), ".squidbot");
}
