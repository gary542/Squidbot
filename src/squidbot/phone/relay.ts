// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: relay/src/splice.ts and companion/src/e2e/README.md @ 96ff8445.
// Modified: admission decision only. The relay stores hashes, never keys, and splices ciphertext.

export const RELAY_ABSENT = 4404;

export interface RelayHost {
  online: boolean;
  /** SHA-256 admission hashes the host has published. The relay never sees the PSK. */
  admissionHashes: ReadonlySet<string>;
}

/** Absent and not-admitted both close 4404 so online status does not leak. */
export function relayPhoneDecision(host: RelayHost | undefined, admissionHash: string): { close: typeof RELAY_ABSENT } | { splice: true } {
  if (!host?.online || !host.admissionHashes.has(admissionHash)) return { close: RELAY_ABSENT };
  return { splice: true };
}

export function relaySeesPlaintext(frame: Buffer, plaintext: string): boolean {
  return frame.includes(Buffer.from(plaintext));
}
