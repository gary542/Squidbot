// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: bind, TLS pinning, and the stricter limits for a relay that is not loopback.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { describe, it } from "node:test";
import { allowComputerRole, exposureWarning, relayAttemptLimit, relayUsesLocalTls, resolveRelayBind } from "./phone/bind.js";
import { readFrame, startPhoneRelay } from "./phone/listener.js";
import { ensurePhoneCertificate, fingerprintOfPem } from "./phone/tls-cert.js";

describe("phone relay reach", () => {
  it("keeps loopback as the default and opts into lan or every interface", () => {
    assert.deepEqual(resolveRelayBind(undefined), { host: "127.0.0.1", exposed: false, mode: "loopback" });
    assert.equal(resolveRelayBind("lan").exposed, true);
    assert.equal(resolveRelayBind("0.0.0.0").mode, "all");
    assert.equal(relayUsesLocalTls(false, undefined), false);
    assert.equal(relayUsesLocalTls(true, undefined), true);
    assert.equal(relayUsesLocalTls(false, "proxy"), false);
    assert.equal(relayUsesLocalTls(true, "proxy"), true);
    assert.equal(relayAttemptLimit(false), 30);
    assert.equal(relayAttemptLimit(true), 5);
    assert.equal(allowComputerRole(true, "192.168.1.20"), false);
    assert.equal(allowComputerRole(true, "127.0.0.1"), true);
    assert.equal(allowComputerRole(false, "192.168.1.20"), true);
  });

  it("binds loopback by default and 0.0.0.0 when asked", async () => {
    const loopback = await startPhoneRelay({ port: 0 });
    const warnings: string[] = [];
    const exposed = await startPhoneRelay({ port: 0, bind: "lan", warn: (message) => warnings.push(message) });
    try {
      assert.equal(loopback.bindHost, "127.0.0.1");
      assert.equal(loopback.exposed, false);
      assert.equal(exposed.bindHost, "0.0.0.0");
      assert.equal(warnings.length, 1);
      assert.match(warnings[0] ?? "", /exposed on 0\.0\.0\.0/);
      assert.equal(warnings[0], exposureWarning("0.0.0.0", exposed.port));
    } finally {
      await loopback.close();
      await exposed.close();
    }
  });

  it("rate-limits a non-loopback bind more tightly", async () => {
    const relay = await startPhoneRelay({ port: 0, bind: "0.0.0.0", maxAttempts: 2, warn: () => undefined });
    try {
      const opened = await Promise.all(
        [0, 1].map(
          () =>
            new Promise<import("node:net").Socket>((resolve, reject) => {
              const socket = connect({ host: "127.0.0.1", port: relay.port });
              socket.once("connect", () => resolve(socket));
              socket.once("error", reject);
            }),
        ),
      );
      const limited = connect({ host: "127.0.0.1", port: relay.port });
      const frame = await readFrame(limited);
      assert.equal(frame.code, 4429);
      for (const socket of opened) socket.destroy();
      limited.destroy();
    } finally {
      await relay.close();
    }
  });

  it("pins the local certificate and puts it in the pairing QR", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-phone-tls-"));
    const material = ensurePhoneCertificate(dir);
    assert.equal(material.fingerprint, fingerprintOfPem(material.cert));
    const relay = await startPhoneRelay({
      port: 0,
      bind: "lan",
      tls: material,
      advertise: "192.168.1.20",
      warn: () => undefined,
    });
    try {
      const issued = relay.issuePairing();
      assert.match(issued.qr, new RegExp(`^squidbot-phone://192\\.168\\.1\\.20:${relay.port}/${issued.code}\\?fp=${material.fingerprint}$`));
      const peer = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const socket = tls.connect({ host: "127.0.0.1", port: relay.port, rejectUnauthorized: false, servername: "squidbot-phone" }, () => resolve(socket));
        socket.once("error", reject);
      });
      assert.equal(peer.getPeerCertificate().fingerprint256.replaceAll(":", "").toLowerCase(), material.fingerprint);
      peer.end();
    } finally {
      await relay.close();
    }
  });
});
