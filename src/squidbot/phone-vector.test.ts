// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: the Android client reads this vector, so it has to match the gateway.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { admission, admissionHash, credentialHash, keyId, psk } from "./phone/credentials.js";
import { TRANSPORT_RELAY, computerAccept, encodePayload1, keyPairFromPrivate, phoneHello } from "./phone/noise.js";

describe("phone vector", () => {
  it("matches the file the Android tests read", () => {
    const vector = JSON.parse(readFileSync("apps/android/app/src/test/resources/squidbot-noise-vector.json", "utf8")) as {
      token: string;
      hostId: string;
      admissionHash: string;
      psk: string;
      computerPublic: string;
      ephemeralPrivate: string;
      responderEphemeralPrivate: string;
      message1: string;
      message2: string;
      plaintext: string;
      record: string;
    };
    const computerPublic = Buffer.from(vector.computerPublic, "hex");
    const secret = psk(credentialHash(vector.token), keyId(computerPublic));
    assert.equal(secret.toString("hex"), vector.psk);
    assert.equal(admissionHash(admission(credentialHash(vector.token), Buffer.from(vector.hostId, "hex"))), vector.admissionHash);
    const hello = phoneHello(
      {
        remoteStatic: computerPublic,
        psk: secret,
        transport: TRANSPORT_RELAY,
        ephemeral: keyPairFromPrivate(Buffer.from(vector.ephemeralPrivate, "hex")),
      },
      encodePayload1(Buffer.alloc(16, 4), "phone"),
      Buffer.alloc(16, 4).toString("base64url"),
    );
    assert.equal(hello.message1.toString("hex"), vector.message1);
    const accepted = computerAccept(
      {
        staticKey: { publicKey: computerPublic, privateKey: Buffer.from(JSON.parse(readFileSync("apps/android/app/src/test/resources/squidbot-noise-vector.json", "utf8")).computerPrivate, "hex") },
        transport: TRANSPORT_RELAY,
        candidates: [{ id: "phone", psk: secret }],
        ephemeral: keyPairFromPrivate(Buffer.from(vector.responderEphemeralPrivate, "hex")),
      },
      hello.message1,
    );
    assert.ok(accepted);
    assert.equal(accepted.message2.toString("hex"), vector.message2);
    const session = hello.finish(accepted.message2);
    assert.equal(session.send.seal(Buffer.from(vector.plaintext)).toString("hex"), vector.record);
  });
});
