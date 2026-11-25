// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: companion pairing described in companion/src/e2e/README.md @ 96ff8445.
// Modified: a short-lived code in this process. The relay stores an admission hash, never the device token.

import { randomBytes, randomInt } from "node:crypto";
import { admission, admissionHash, credentialHash } from "./credentials.js";

export const PAIRING_TTL_MS = 5 * 60_000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface PairingCode {
  code: string;
  qr: string;
  expiresAt: number;
}

export interface PairedDevice {
  id: string;
  token: string;
  admissionHash: string;
  expiresAt: number;
}

interface OpenCode {
  code: string;
  expiresAt: number;
  used: boolean;
}

export class PairingTable {
  private readonly codes = new Map<string, OpenCode>();
  private readonly devices = new Map<string, { hash: string; revoked: boolean }>();

  issue(now = Date.now()): PairingCode {
    let code = "";
    do {
      code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    } while (this.codes.has(code));
    const expiresAt = now + PAIRING_TTL_MS;
    this.codes.set(code, { code, expiresAt, used: false });
    return { code, qr: `squidbot-phone:${code}`, expiresAt };
  }

  /** Returns the device token once. A second claim, an expired code, or an unknown code returns null. */
  claim(code: string, hostId: Uint8Array, now = Date.now()): PairedDevice | null {
    const open = this.codes.get(code.trim().toUpperCase());
    if (!open || open.used || open.expiresAt <= now) return null;
    open.used = true;
    const token = `sqd_phone_${randomBytes(24).toString("base64url")}`;
    const hash = admissionHash(admission(credentialHash(token), hostId));
    const id = `dev_${randomBytes(4).toString("hex")}`;
    this.devices.set(id, { hash, revoked: false });
    return { id, token, admissionHash: hash, expiresAt: open.expiresAt };
  }

  revoke(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device || device.revoked) return false;
    device.revoked = true;
    return true;
  }

  admittedHashes(): Set<string> {
    const hashes = new Set<string>();
    for (const device of this.devices.values()) {
      if (!device.revoked) hashes.add(device.hash);
    }
    return hashes;
  }
}
