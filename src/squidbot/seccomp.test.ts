// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: the boxed-turn allowlist permits ordinary tools and blocks the dangerous calls.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SECCOMP_SYSCALLS, seccompDecision, seccompProfile } from "./seccomp.js";

describe("seccomp allowlist", () => {
  const profile = seccompProfile();

  for (const [name, syscalls] of Object.entries(SECCOMP_SYSCALLS)) {
    it(`lets ${name} tools read, write, and exec`, () => {
      assert.equal(seccompDecision(profile, syscalls.arch, syscalls.read), "allow");
      assert.equal(seccompDecision(profile, syscalls.arch, syscalls.write), "allow");
      assert.equal(seccompDecision(profile, syscalls.arch, syscalls.execve), "allow");
    });

    it(`blocks ${name} ptrace, mount, kexec, bpf, and unshare`, () => {
      for (const nr of [syscalls.ptrace, syscalls.mount, syscalls.unshare, syscalls.kexec, syscalls.kexecFile, syscalls.bpf]) {
        assert.equal(seccompDecision(profile, syscalls.arch, nr), "errno");
      }
    });
  }

  it("kills an unknown architecture", () => {
    assert.equal(seccompDecision(profile, 0, 0), "kill");
  });
});
