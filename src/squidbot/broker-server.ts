// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/bot-box/broker.ts @ 96ff8445.
// Modified: loopback HTTP and a unix socket. Tokens are swapped and the upstream body is streamed back.

import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorizeBrokerCall } from "./broker.js";

let httpServer: Server | undefined;
let socketServer: Server | undefined;
let baseUrl: string | undefined;
let socketPath: string | undefined;

export function brokerSocketPath(): string | undefined {
  return socketPath;
}

function headerMap(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function proxy(req: IncomingMessage, res: ServerResponse, upstream: string, headers: Record<string, string>, tail: string, search: string): Promise<void> {
  const target = new URL(tail ? `${upstream.replace(/\/$/u, "")}/${tail}` : upstream);
  if (search) target.search = search;
  return new Promise((resolve, reject) => {
    void readBody(req).then((body) => {
      const outbound: Record<string, string> = {};
      for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() === "host" || name.toLowerCase() === "content-length") continue;
        outbound[name] = value;
      }
      const upstreamReq = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: req.method,
          headers: outbound,
        },
        (upstreamRes) => {
          const contentType = upstreamRes.headers["content-type"];
          res.writeHead(upstreamRes.statusCode ?? 502, typeof contentType === "string" ? { "content-type": contentType } : {});
          upstreamRes.pipe(res);
          upstreamRes.on("end", () => resolve());
        },
      );
      upstreamReq.once("error", reject);
      if (req.method !== "GET" && req.method !== "HEAD") upstreamReq.write(body);
      upstreamReq.end();
    }).catch(reject);
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  if (decision.status !== 200 || !decision.upstream || !decision.headers) {
    res.writeHead(decision.status, { "content-type": "text/plain" }).end(decision.error ?? "");
    return;
  }
  try {
    await proxy(req, res, decision.upstream, decision.headers, parts.slice(3).join("/"), url.search);
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream failed";
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(message);
  }
}

function onRequest(req: IncomingMessage, res: ServerResponse): void {
  void handle(req, res);
}

/** One loopback broker per process. Real keys stay in this process. */
export async function ensureBrokerBase(): Promise<string> {
  if (baseUrl && httpServer && socketServer) return baseUrl;
  const http = createHttpServer(onRequest);
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolve());
  });
  const address = http.address();
  if (!address || typeof address === "string") {
    http.close();
    throw new Error("Squidbot broker did not bind a loopback port.");
  }
  const sock = path.join(tmpdir(), `squidbot-broker-${address.port}.sock`);
  try {
    unlinkSync(sock);
  } catch {
    // The socket file is absent until the first bind.
  }
  const unixHttp = createHttpServer(onRequest);
  await new Promise<void>((resolve, reject) => {
    unixHttp.once("error", reject);
    unixHttp.listen(sock, () => resolve());
  });
  httpServer = http;
  socketServer = unixHttp;
  socketPath = sock;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return baseUrl;
}

export function requestBroker(input: { socketPath: string; path: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { socketPath: input.socketPath, path: input.path, method: input.method ?? "POST", headers: input.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.once("error", reject);
    if (input.body) req.write(input.body);
    req.end();
  });
}

export async function stopBroker(): Promise<void> {
  const http = httpServer;
  const unix = socketServer;
  const sock = socketPath;
  httpServer = undefined;
  socketServer = undefined;
  socketPath = undefined;
  baseUrl = undefined;
  await Promise.all([
    http ? new Promise<void>((resolve) => http.close(() => resolve())) : Promise.resolve(),
    unix ? new Promise<void>((resolve) => unix.close(() => resolve())) : Promise.resolve(),
  ]);
  if (sock) {
    try {
      unlinkSync(sock);
    } catch {
      // Already removed.
    }
  }
}
