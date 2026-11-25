#!/usr/bin/env node
// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: reference phone client. Run with the TypeScript loader, for example:
// node --import ./scripts/squidbot-test-register.mjs --experimental-strip-types scripts/squidbot-phone.mjs pair

import { connectComputer } from "../src/squidbot/phone/client.js";
import { startPhoneRelayFromEnv, stopPhoneRelay } from "../src/squidbot/phone/gateway.js";

const [command, code] = process.argv.slice(2);
const relay = await startPhoneRelayFromEnv({ ...process.env, SQUIDBOT_PHONE_RELAY: "1" });
if (!relay) {
  console.error("The phone relay did not start.");
  process.exit(1);
}

if (command === "pair") {
  const issued = relay.issuePairing();
  const computer = await connectComputer(relay.port);
  console.log(`code ${issued.code}`);
  console.log(`qr ${issued.qr}`);
  console.log(`relay 127.0.0.1:${relay.port}`);
  computer.on("close", () => {
    void stopPhoneRelay();
  });
} else if (command === "revoke" && code) {
  console.log(relay.revoke(code) ? "revoked" : "unknown");
  await stopPhoneRelay();
} else {
  console.log("usage: squidbot-phone.mjs pair | revoke <deviceId>");
  await stopPhoneRelay();
}
