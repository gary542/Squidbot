// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/composio-session.ts, server/connector-verdict.ts @ 96ff8445.
// Modified: self-hosted project key only. No managed broker, no Cloudflare worker.

export const MULTI_ACCOUNT_CONFIG = {
  enable: true,
  max_accounts_per_toolkit: 10,
  require_explicit_selection: true,
} as const;

export const APP_SANDBOX_TOOLS = ["COMPOSIO_REMOTE_WORKBENCH", "COMPOSIO_REMOTE_BASH_TOOL"] as const;
export const COMPOSIO_MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";
const TOOL_NAME = /^[A-Z][A-Z0-9_]*$/;

export interface ConnectorToolGrant {
  tools: "*" | string[];
  /** read allows listed tools that the caller marks read-only. write allows every granted tool. */
  scope?: "read" | "write";
  accounts?: string[];
}

export interface ComposioSettings {
  /** Composio project key (ak_…). Empty means connected apps are off. */
  apiKey?: string;
  apiBase?: string;
  userId?: string;
  /** Per-agent grants. Missing record = legacy all-tools. Empty object = no tools. */
  grants?: Record<string, Record<string, ConnectorToolGrant>>;
}

/** A user project key always wins. There is no hosted broker. */
export function projectApiKey(settings: ComposioSettings | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.SQUIDBOT_COMPOSIO_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const saved = settings?.apiKey?.trim();
  return saved || null;
}

export function trustedSessionMcpUrl(value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let mcp: URL;
  try {
    mcp = new URL(value);
  } catch {
    return false;
  }
  if (mcp.protocol === "https:" && (mcp.hostname === "composio.dev" || mcp.hostname.endsWith(".composio.dev"))) {
    return true;
  }
  if (mcp.protocol !== "https:" && !(mcp.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(mcp.hostname))) {
    return false;
  }
  const override = env.SQUIDBOT_COMPOSIO_API;
  if (!override) return false;
  try {
    return new URL(override).origin === mcp.origin;
  } catch {
    return false;
  }
}

export interface SessionResponse {
  session_id: string;
  mcp: { type: "http" | "sse"; url: string };
}

export function parseSessionResponse(value: unknown, env: NodeJS.ProcessEnv = process.env): SessionResponse {
  if (!value || typeof value !== "object") throw new Error("Composio returned an untrusted Session MCP URL");
  const row = value as { session_id?: unknown; mcp?: { type?: unknown; url?: unknown } };
  if (typeof row.session_id !== "string" || !row.session_id) throw new Error("Composio returned an untrusted Session MCP URL");
  if (!row.mcp || (row.mcp.type !== "http" && row.mcp.type !== "sse") || typeof row.mcp.url !== "string") {
    throw new Error("Composio returned an untrusted Session MCP URL");
  }
  if (!trustedSessionMcpUrl(row.mcp.url, env)) throw new Error("Composio returned an untrusted Session MCP URL");
  return { session_id: row.session_id, mcp: { type: row.mcp.type, url: new URL(row.mcp.url).toString() } };
}

export function sessionCreateBody(userId: string) {
  return {
    user_id: userId,
    manage_connections: { enable: true, enable_wait_for_connections: true, enable_connection_removal: true },
    multi_account: MULTI_ACCOUNT_CONFIG,
  };
}

export type ConnectorCall =
  | { kind: "passthrough" }
  | { kind: "tools"; invoked: string; names: string[] }
  | { kind: "unrecognized"; invoked: string; reason: string };

export function serviceSlugFor(tool: string): string | null {
  const start = tool.startsWith("_") ? 1 : 0;
  const underscore = tool.indexOf("_", start);
  if (underscore <= start) return null;
  return tool.slice(0, underscore).toLowerCase();
}

export function connectorCallFromFrame(payload: unknown): ConnectorCall {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { kind: "passthrough" };
  const frame = payload as { method?: unknown; params?: unknown };
  if (frame.method !== "tools/call") return { kind: "passthrough" };
  const params = frame.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { kind: "unrecognized", invoked: "tools/call", reason: "the call carried no params object" };
  }
  const name = (params as { name?: unknown }).name;
  if (typeof name !== "string" || !name) return { kind: "unrecognized", invoked: "tools/call", reason: "the call named no tool" };
  if (name === COMPOSIO_MULTI_EXECUTE_TOOL) return multiExecuteCall(name, (params as { arguments?: unknown }).arguments);
  if (name.startsWith("COMPOSIO_")) return { kind: "passthrough" };
  if (name.endsWith("_MANAGE_CONNECTIONS") || name.endsWith("_WAIT_FOR_CONNECTIONS")) return { kind: "passthrough" };
  if (!TOOL_NAME.test(name)) return { kind: "unrecognized", invoked: name, reason: "the tool name is not a connected-app tool name" };
  return { kind: "tools", invoked: name, names: [name] };
}

function multiExecuteCall(invoked: string, args: unknown): ConnectorCall {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { kind: "unrecognized", invoked, reason: "the arguments were not an object" };
  }
  const tools = (args as { tools?: unknown }).tools;
  if (Array.isArray(tools)) {
    if (tools.length === 0) return { kind: "unrecognized", invoked, reason: "the tools list was empty" };
    const names: string[] = [];
    for (const item of tools) {
      const slug = item && typeof item === "object" && !Array.isArray(item) ? (item as { tool_slug?: unknown }).tool_slug : undefined;
      if (typeof slug !== "string" || !slug) {
        return { kind: "unrecognized", invoked, reason: "an entry in the tools list named no tool_slug" };
      }
      names.push(slug);
    }
    return { kind: "tools", invoked, names };
  }
  return { kind: "unrecognized", invoked, reason: "the arguments named no tools to execute" };
}

export interface ConnectorVerdict {
  allowed: boolean;
  legacy: boolean;
  denials: Array<{ tool: string; service: string | null; onGrantedService: boolean }>;
  message: string;
}

export function evaluateConnectorTools(
  names: string[],
  grants: Record<string, ConnectorToolGrant> | undefined,
): ConnectorVerdict {
  if (grants === undefined) {
    return { allowed: true, legacy: true, denials: [], message: "" };
  }
  const denials: ConnectorVerdict["denials"] = [];
  for (const tool of new Set(names)) {
    const service = serviceSlugFor(tool);
    const grant = service !== null && Object.hasOwn(grants, service) ? grants[service] : undefined;
    if (grant && (grant.tools === "*" || grant.tools.includes(tool))) continue;
    denials.push({ tool, service, onGrantedService: Boolean(grant) });
  }
  if (denials.length === 0) return { allowed: true, legacy: false, denials: [], message: "" };
  if (denials.every((denial) => (APP_SANDBOX_TOOLS as readonly string[]).includes(denial.tool))) {
    return {
      allowed: false,
      legacy: false,
      denials,
      message: "This call was not performed. Connected-app sandbox tools run only at full access, and only as a direct call.",
    };
  }
  const named = denials.map((denial) => `"${denial.tool}"`).join(", ");
  const one = denials.length === 1;
  return {
    allowed: false,
    legacy: false,
    denials,
    message: `${named} ${one ? "is" : "are"} not granted to this agent. This call was not performed. Ask the person to grant ${one ? "it" : "these tools"} if they want ${one ? "it" : "them"} run.`,
  };
}

/** The harness verdict for one tools/call. A missing grant record is legacy allow. A missing tool is a refusal. */
export function verdictForAgentCall(
  settings: ComposioSettings | undefined,
  agentId: string,
  frame: unknown,
  fullAccess = false,
): ConnectorVerdict {
  const call = connectorCallFromFrame(frame);
  if (call.kind === "passthrough") return { allowed: true, legacy: false, denials: [], message: "" };
  if (call.kind === "unrecognized") {
    return {
      allowed: false,
      legacy: false,
      denials: [],
      message: `A ${call.invoked} call arrived in a shape Squidbot could not read (${call.reason}), so it was not performed.`,
    };
  }
  const sandbox = call.names.some((name) => (APP_SANDBOX_TOOLS as readonly string[]).includes(name));
  if (sandbox && !fullAccess) {
    return evaluateConnectorTools(call.names, { composio: { tools: [] } });
  }
  const grants = settings?.grants?.[agentId];
  return evaluateConnectorTools(call.names, grants);
}
