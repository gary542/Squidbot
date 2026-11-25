// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Adapted from NousResearch/hermes-agent (MIT), modified for Squidbot.
// Modified: take-control lease and RFB input filter tests.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TakeControlLease, pickComputer } from "./desktops.js";
import { RfbClientFilter } from "./rfb-filter.js";

function keyDown(): Buffer {
  const key = Buffer.alloc(8);
  key[0] = 4;
  key[1] = 1;
  key.writeUInt32BE(0x61, 4);
  return key;
}

describe("per-agent desktops", () => {
  it("refuses viewer input while the bot holds and refuses the bot while a person holds", () => {
    const lease = new TakeControlLease();
    assert.equal(lease.botMayAct().allowed, true);
    assert.equal(lease.viewerMayInput(), false);
    const botView = new RfbClientFilter({ allowInput: () => lease.viewerMayInput() });
    botView.feed(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]));
    const dropped = botView.feed(keyDown());
    assert.equal(dropped.length, 0);

    lease.take();
    assert.equal(lease.botMayAct().allowed, false);
    assert.match(lease.botMayAct().reason, /person holds/);
    const personView = new RfbClientFilter({ allowInput: () => lease.viewerMayInput() });
    personView.feed(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]));
    const passed = personView.feed(keyDown());
    assert.equal(passed[0], 4);
    lease.release();
    assert.equal(lease.botMayAct().allowed, true);
  });

  it("keeps a bot on the current computer instead of moving itself", () => {
    assert.equal(pickComputer({ current: "ssh", ready: ["container", "ssh"] }).place, "ssh");
    assert.equal(pickComputer({ requested: "host", current: "container", ready: ["container"] }).reason, "requested-unavailable");
  });
});
