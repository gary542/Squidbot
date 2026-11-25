// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: the phone relay stays on loopback unless the operator opts in.

export type RelayBind = { host: string; exposed: boolean; mode: "loopback" | "lan" | "all" };

export function resolveRelayBind(value: string | undefined): RelayBind {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "" || raw === "loopback" || raw === "127.0.0.1") {
    return { host: "127.0.0.1", exposed: false, mode: "loopback" };
  }
  if (raw === "lan") return { host: "0.0.0.0", exposed: true, mode: "lan" };
  if (raw === "0.0.0.0" || raw === "all") return { host: "0.0.0.0", exposed: true, mode: "all" };
  throw new Error("SQUIDBOT_PHONE_RELAY_BIND must be loopback, lan, or 0.0.0.0");
}

/** Local TLS unless the operator terminates TLS on their own proxy. Exposed cleartext is refused. */
export function relayUsesLocalTls(exposed: boolean, flag: string | undefined): boolean {
  const raw = (flag ?? "").trim().toLowerCase();
  if (exposed) return true;
  if (raw === "proxy" || raw === "0" || raw === "off" || raw === "") return false;
  return raw === "1" || raw === "on" || raw === "local";
}

export function relayAttemptLimit(exposed: boolean): number {
  return exposed ? 5 : 30;
}

export function isLoopbackAddress(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export function exposureWarning(host: string, port: number): string {
  return `Squidbot phone relay is exposed on ${host}:${port}. Loopback is the default. Prefer Tailscale or a TCP tunnel instead of opening a port.`;
}

/** The computer role stays on loopback even when phones may connect from the network. */
export function allowComputerRole(exposed: boolean, ip: string): boolean {
  return !exposed || isLoopbackAddress(ip);
}
