// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: the bubblewrap seccomp note in server/bot-box @ 96ff8445.
// Modified: an allowlist for boxed turns on x86_64 and aarch64.

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BPF_LD_W_ABS = 0x20;
const BPF_JMP_JEQ_K = 0x15;
const BPF_RET_K = 0x06;
const AUDIT_ARCH_X86_64 = 0xc000003e;
const AUDIT_ARCH_AARCH64 = 0xc00000b7;
const SECCOMP_RET_KILL = 0x80000000;
const SECCOMP_RET_ERRNO = 0x00050000;
const SECCOMP_RET_ALLOW = 0x7fff0000;
const EPERM = 1;

/** Calls a boxed shell or Node tool needs. ptrace, mount, kexec, bpf, and unshare are absent. */
const X86_64_ALLOW = [
  0, 1, 3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 28, 32, 33, 35, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 72, 73, 74, 79, 80, 82, 83, 84, 87, 89, 96, 97, 98, 99, 102, 104, 107, 108, 110, 111, 112, 157, 158, 186, 202, 204, 217, 218, 228, 230, 231, 232, 233, 234, 247, 257, 258, 262, 263, 264, 266, 267, 269, 270, 271, 273, 288, 290, 291, 292, 293, 302, 318, 332, 334, 435, 436,
];

/** aarch64 uses the generic syscall table. The same tools are allowed. The same dangerous calls are not. */
const AARCH64_ALLOW = [
  17, 19, 23, 25, 29, 34, 35, 46, 47, 48, 49, 50, 51, 56, 57, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 78, 79, 80, 82, 83, 93, 94, 96, 98, 113, 115, 124, 129, 130, 131, 132, 134, 135, 172, 173, 174, 176, 178, 179, 198, 203, 214, 215, 220, 221, 222, 226, 233, 260, 261, 276, 278, 279, 281, 291, 293, 435,
];

export const SECCOMP_SYSCALLS = {
  x86_64: { arch: AUDIT_ARCH_X86_64, read: 0, write: 1, execve: 59, ptrace: 101, mount: 165, unshare: 272, kexec: 246, kexecFile: 320, bpf: 321 },
  aarch64: { arch: AUDIT_ARCH_AARCH64, read: 63, write: 64, execve: 221, ptrace: 117, mount: 40, unshare: 97, kexec: 104, kexecFile: 294, bpf: 280 },
} as const;

function instruction(code: number, jt: number, jf: number, k: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt16LE(code, 0);
  bytes.writeUInt8(jt, 2);
  bytes.writeUInt8(jf, 3);
  bytes.writeUInt32LE(k >>> 0, 4);
  return bytes;
}

function allowlist(syscalls: readonly number[]): Buffer[] {
  const unique = [...new Set(syscalls)].sort((a, b) => a - b);
  const filters = [instruction(BPF_LD_W_ABS, 0, 0, 0)];
  for (let index = 0; index < unique.length; index += 1) {
    filters.push(instruction(BPF_JMP_JEQ_K, unique.length - index, 0, unique[index] ?? 0));
  }
  filters.push(instruction(BPF_RET_K, 0, 0, SECCOMP_RET_ERRNO | EPERM));
  filters.push(instruction(BPF_RET_K, 0, 0, SECCOMP_RET_ALLOW));
  return filters;
}

/** Compiled cBPF. bwrap loads it with `--seccomp 3`. Unknown architectures are killed. */
export function seccompProfile(): Buffer {
  const x86 = allowlist(X86_64_ALLOW);
  const arm = allowlist(AARCH64_ALLOW);
  const armAt = 4 + x86.length;
  const x86Jump = 2;
  const armJump = armAt - 2 - 1;
  return Buffer.concat([
    instruction(BPF_LD_W_ABS, 0, 0, 4),
    instruction(BPF_JMP_JEQ_K, x86Jump, 0, AUDIT_ARCH_X86_64),
    instruction(BPF_JMP_JEQ_K, armJump, 0, AUDIT_ARCH_AARCH64),
    instruction(BPF_RET_K, 0, 0, SECCOMP_RET_KILL),
    ...x86,
    ...arm,
  ]);
}

export type SeccompVerdict = "allow" | "errno" | "kill";

/** Runs the small subset of cBPF this profile emits. */
export function seccompDecision(profile: Buffer, arch: number, nr: number): SeccompVerdict {
  let accumulator = 0;
  let pc = 0;
  for (let steps = 0; steps < 1000 && pc * 8 + 8 <= profile.length; steps += 1) {
    const at = pc * 8;
    const code = profile.readUInt16LE(at);
    const jt = profile.readUInt8(at + 2);
    const jf = profile.readUInt8(at + 3);
    const k = profile.readUInt32LE(at + 4);
    if (code === BPF_LD_W_ABS) {
      accumulator = k === 0 ? nr >>> 0 : k === 4 ? arch >>> 0 : 0;
      pc += 1;
      continue;
    }
    if (code === BPF_JMP_JEQ_K) {
      pc += 1 + (accumulator === k ? jt : jf);
      continue;
    }
    if (code === BPF_RET_K) {
      if (k === SECCOMP_RET_ALLOW) return "allow";
      if ((k & 0xffff0000) === SECCOMP_RET_ERRNO) return "errno";
      return "kill";
    }
    return "kill";
  }
  return "kill";
}

export function seccompDeniesPtrace(profile: Buffer): boolean {
  return seccompDecision(profile, AUDIT_ARCH_X86_64, SECCOMP_SYSCALLS.x86_64.ptrace) === "errno";
}

export function writeSeccompProfile(): string | null {
  const profile = seccompProfile();
  if (profile.length === 0) return null;
  const file = path.join(tmpdir(), "squidbot-seccomp.bpf");
  writeFileSync(file, profile);
  return file;
}
