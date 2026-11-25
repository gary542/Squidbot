// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/bot-box/broker.ts @ 96ff8445.
// Modified: loopback HTTP front for the in-process token table. It does not forward unless asked.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { authorizeBrokerCall } from "./broker.js";

let server: Server | undefined;
let baseUrl: string | undefined;

function headerMap(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "b" || !parts[1] || !parts[2]) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not a broker path");
    return;
  }
  const decision = authorizeBrokerCall({
    token: decodeURIComponent(parts[1]),
    grant: decodeURIComponent(parts[2]),
    clientHeaders: headerMap(req),
  });
  if (decision.status !== 200) {
    res.writeHead(decision.status, { "content-type": "text/plain" }).end(decision.error ?? "");
    return;
  }
  res.writeHead(204, { "x-squidbot-upstream": decision.upstream ?? "" }).end();
}

/** One loopback broker per process. Real keys stay in this process. */
export async function ensureBrokerBase(): Promise<string> {
  if (baseUrl && server) return baseUrl;
  const created = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    created.once("error", reject);
    created.listen(0, "127.0.0.1", () => resolve());
  });
  const address = created.address();
  if (!address || typeof address === "string") {
    created.close();
    throw new Error("Squidbot broker did not bind a loopback port.");
  }
  server = created;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return baseUrl;
}

export async function stopBroker(): Promise<void> {
  const current = server;
  server = undefined;
  baseUrl = undefined;
  if (!current) return;
  await new Promise<void>((resolve) => current.close(() => resolve()));
}
