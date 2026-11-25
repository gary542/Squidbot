// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: Noise handshake round trip and blind-relay admission tests.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { credentialHash, keyId, psk } from "./phone/credentials.js";
import { TRANSPORT_DIRECT, TRANSPORT_RELAY, encodePayload1, generateKeyPair, phoneHello, computerAccept, newConn } from "./phone/noise.js";
import { RELAY_ABSENT, relayPhoneDecision, relaySeesPlaintext } from "./phone/relay.js";
import { admissionHash, admission } from "./phone/credentials.js";

describe("phone relay", () => {
  it("round-trips a sealed record and rejects the wrong transport and an unknown PSK", () => {
    const identity = generateKeyPair();
    const cred = "squidbot_example_device_token";
    const good = psk(credentialHash(cred), keyId(identity.publicKey));
    const wrong = psk(credentialHash("squidbot_other"), keyId(identity.publicKey));
    const conn = newConn();
    const hello = phoneHello(
      { remoteStatic: identity.publicKey, psk: good, transport: TRANSPORT_RELAY },
      encodePayload1(conn, "smoke"),
      conn.toString("base64url"),
    );
    const accepted = computerAccept(
      { staticKey: identity, transport: TRANSPORT_RELAY, candidates: [{ id: "other", psk: wrong }, { id: "phone-1", psk: good }] },
      hello.message1,
    );
    assert.ok(accepted);
    const phone = hello.finish(accepted.message2);
    assert.equal(phone.handshakeHash.equals(accepted.keys.handshakeHash), true);
    const sealed = phone.send.seal(Buffer.from("hello computer"));
    assert.equal(accepted.keys.receive.open(sealed).toString(), "hello computer");
    assert.equal(relaySeesPlaintext(sealed, "hello computer"), false);
    const unknown = computerAccept(
      { staticKey: identity, transport: TRANSPORT_RELAY, candidates: [{ id: "other", psk: wrong }] },
      hello.message1,
    );
    assert.equal(unknown, null);
    const wrongTransport = computerAccept(
      { staticKey: identity, transport: TRANSPORT_DIRECT, candidates: [{ id: "phone-1", psk: good }] },
      hello.message1,
    );
    assert.equal(wrongTransport, null);
  });

  it("closes 4404 when the host is absent or the phone is not admitted", () => {
    const hash = admissionHash(admission(credentialHash("squidbot_device"), Buffer.alloc(16, 7)));
    assert.deepEqual(relayPhoneDecision(undefined, hash), { close: RELAY_ABSENT });
    assert.deepEqual(relayPhoneDecision({ online: true, admissionHashes: new Set() }, hash), { close: RELAY_ABSENT });
    assert.deepEqual(relayPhoneDecision({ online: false, admissionHashes: new Set([hash]) }, hash), { close: RELAY_ABSENT });
    assert.deepEqual(relayPhoneDecision({ online: true, admissionHashes: new Set([hash]) }, hash), { splice: true });
    assert.equal(RELAY_ABSENT, 4404);
  });
});
