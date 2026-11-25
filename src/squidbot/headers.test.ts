// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: fails when a ported or modified Squidbot file drops its attribution header.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HEADER = "modified for Squidbot";
const ADAPTED = "Adapted from";

const MODIFIED = [
  "src/cli/banner.ts",
  "src/cli/run-main.ts",
  "src/cli/templates-cli.ts",
  "src/cli/program/register.agent.ts",
  "src/gateway/worker-environments/worker-turn-user-message.ts",
  "src/cron/service/timer-execution.ts",
  "packages/gateway-protocol/src/theme.ts",
  "ui/index.html",
  "ui/src/components/theme-brand-label.ts",
  "src/agents/system-prompt-control.ts",
  "src/agents/bash-tools.exec-request-preparation.ts",
  "src/gateway/desktop/computer-service.ts",
  "src/sessions/classify-session-kind.ts",
  "src/commands/sessions.ts",
  "ui/src/app-route-paths.ts",
  "ui/src/app-navigation.ts",
  "ui/src/app-routes.ts",
  "ui/src/pages/rooms/route.ts",
  "ui/src/pages/rooms/room-page.tsx",
  "ui/src/pages/desktops/route.ts",
  "ui/src/pages/desktops/desktops-page.tsx",
  "packages/session-url-contract/src/share.ts",
  "src/gateway/server.ts",
  "scripts/squidbot-phone.mjs",
  "apps/android/app/src/main/java/ai/openclaw/app/squidbot/SquidbotProtocol.kt",
  "apps/android/app/src/main/java/ai/openclaw/app/squidbot/SquidbotPhoneActivity.kt",
  "apps/android/app/src/main/java/ai/openclaw/app/squidbot/DeviceKeyStore.kt",
  "apps/android/app/src/test/java/ai/openclaw/app/squidbot/SquidbotProtocolTest.kt",
  "apps/android/app/src/test/java/ai/openclaw/app/squidbot/SquidbotProtocolJunitTest.kt",
  "README.md",
  "NOTICE",
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.(ts|tsx|js|mjs|md|html)$/u.test(entry)) out.push(full);
  }
  return out;
}

describe("attribution headers", () => {
  it("requires an Adapted-from header on ported Squidbot files and modified product files", () => {
    const ported = filesUnder(path.join(ROOT, "src/squidbot"));
    const modified = MODIFIED.map((relative) => path.join(ROOT, relative));
    const missing: string[] = [];
    for (const file of [...ported, ...modified]) {
      const text = readFileSync(file, "utf8");
      if (!text.includes(ADAPTED) || !text.includes(HEADER)) missing.push(path.relative(ROOT, file));
    }
    assert.deepEqual(missing, []);
  });
});
