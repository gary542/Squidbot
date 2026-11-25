// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Adapted from T3 Code (MIT), modified for Squidbot.
// Upstream: server/browser/egress/policy.ts via server/bot-box/egress-gate.ts @ 96ff8445.
// Modified: address classification only. The live proxy starts when SQUIDBOT_BOT_BOX=1.

import { isIP } from "node:net";

export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isPublicV4(address);
  if (kind === 6) return isPublicV6(address);
  return false;
}

function isPublicV4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a >= 224) return false;
  return true;
}

function isPublicV6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return false;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return false;
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isPublicV4(mapped) : false;
  }
  return true;
}

export function egressDecision(addresses: readonly string[]): { allowed: boolean; reason: string } {
  if (addresses.length === 0) return { allowed: false, reason: "unresolved" };
  for (const address of addresses) {
    if (!isPublicAddress(address)) return { allowed: false, reason: `refused ${address}` };
  }
  return { allowed: true, reason: "public" };
}
