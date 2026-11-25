---
name: squidbot-phone-relay
description: Describe the Squidbot phone link. The Noise handshake is implemented. A listening relay stays behind SQUIDBOT_PHONE_RELAY=1.
---

# Squidbot phone relay

The listening relay stays off unless `SQUIDBOT_PHONE_RELAY=1`. There is no
phone app in this repository.

The computer and phone agree keys at pairing. The handshake is
`Noise_NKpsk0_P256_AESGCM_SHA256` with prologue `squidbot-e2e/1`. A relay
that only splices bytes cannot read the records. If the host is offline or
the phone's admission hash is absent, the relay closes with 4404 in both
cases, so online status does not leak. Do not point this at anyone else's
relay hosts.
