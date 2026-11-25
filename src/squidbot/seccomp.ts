// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: the bubblewrap seccomp note in server/bot-box @ 96ff8445.
// Modified: a small x86_64 filter. ptrace is rejected. Other calls are allowed.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BPF_LD_W_ABS = 0x20;
const BPF_JMP_JEQ_K = 0x15;
const BPF_RET_K = 0x06;
const AUDIT_ARCH_X86_64 = 0xc000003e;
const PTRACE = 101;
const SECCOMP_RET_KILL = 0x80000000;
const SECCOMP_RET_ERRNO = 0x00050000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const EPERM = 1;

function instruction(code: number, jt: number, jf: number, k: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt16LE(code, 0);
  bytes.writeUInt8(jt, 2);
  bytes.writeUInt8(jf, 3);
  bytes.writeUInt32LE(k >>> 0, 4);
  return bytes;
}

/** Compiled cBPF. bwrap loads it with `--seccomp 3`. */
export function seccompProfile(): Buffer {
  if (process.arch !== "x64") return Buffer.alloc(0);
  return Buffer.concat([
    instruction(BPF_LD_W_ABS, 0, 0, 4),
    instruction(BPF_JMP_JEQ_K, 1, 0, AUDIT_ARCH_X86_64),
    instruction(BPF_RET_K, 0, 0, SECCOMP_RET_KILL),
    instruction(BPF_LD_W_ABS, 0, 0, 0),
    instruction(BPF_JMP_JEQ_K, 0, 1, PTRACE),
    instruction(BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO | EPERM),
    instruction(BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW),
  ]);
}

export function seccompDeniesPtrace(profile: Buffer): boolean {
  if (profile.length < 8 * 5) return false;
  const syscall = profile.readUInt32LE(4 + 8 * 4);
  const deny = profile.readUInt32LE(4 + 8 * 5);
  return syscall === PTRACE && deny === (SECCOMP_RET_ERRNO | EPERM);
}

export function writeSeccompProfile(): string | null {
  const profile = seccompProfile();
  if (profile.length === 0) return null;
  const file = path.join(tmpdir(), "squidbot-seccomp.bpf");
  writeFileSync(file, profile);
  return file;
}
