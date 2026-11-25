// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: tests for the self-hosted Composio session and per-agent grants.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSessionResponse, projectApiKey, trustedSessionMcpUrl, verdictForAgentCall } from "./composio.js";

describe("composio connected apps", () => {
  it("accepts only composio.dev session URLs unless an explicit API origin is set", () => {
    assert.equal(trustedSessionMcpUrl("https://mcp.composio.dev/session/abc", {}), true);
    assert.equal(trustedSessionMcpUrl("https://evil.example/mcp", {}), false);
    assert.throws(() => parseSessionResponse({ session_id: "s", mcp: { type: "http", url: "https://evil.example/mcp" } }, {}));
    assert.equal(projectApiKey({ apiKey: "" }, { SQUIDBOT_COMPOSIO_API_KEY: "ak_test" }), "ak_test");
  });

  it("refuses a tool call when the agent has no grant for it", () => {
    const frame = { method: "tools/call", params: { name: "GMAIL_SEND_EMAIL", arguments: {} } };
    const missing = verdictForAgentCall({ grants: { ada: { gmail: { tools: ["GMAIL_FETCH_EMAILS"] } } } }, "ada", frame);
    assert.equal(missing.allowed, false);
    assert.match(missing.message, /not granted/);
    const allowed = verdictForAgentCall({ grants: { ada: { gmail: { tools: ["GMAIL_SEND_EMAIL"] } } } }, "ada", frame);
    assert.equal(allowed.allowed, true);
    const legacy = verdictForAgentCall({ grants: {} }, "ada", frame);
    assert.equal(legacy.allowed, true);
    assert.equal(legacy.legacy, true);
  });
});
