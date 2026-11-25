// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: gateway room session tests for routing, mentions, hand-offs, and caps.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { setPaused } from "./pause.js";
import { listRoomPanels, mentionedMember, openRoom, postRoomMessage, resetRooms, roomPanelHtml } from "./room-gateway.js";

const members = [
  { id: "ada", name: "Ada", lead: true },
  { id: "grace", name: "Grace" },
];

describe("gateway rooms", () => {
  it("stays off and leaves room keys as direct sessions until the flag is set", async () => {
    resetRooms();
    assert.equal(openRoom({ id: "lab", title: "Lab", members, env: {} }), null);
    const posted = await postRoomMessage({ roomId: "lab", from: "Gary", role: "human", text: "hello", env: {} });
    assert.equal(posted.enabled, false);
  });

  it("routes a room, honors an @mention, and refuses a paused bot", async () => {
    resetRooms();
    const env = { SQUIDBOT_ROOMS: "1" };
    const previous = process.env.SQUIDBOT_ROOMS;
    process.env.SQUIDBOT_ROOMS = "1";
    const dir = mkdtempSync(path.join(tmpdir(), "squidbot-room-"));
    try {
      assert.equal(mentionedMember("@Grace the numbers", members)?.id, "grace");
      openRoom({ id: "lab", title: "Lab", humans: ["Gary"], members, env });
      const routed = await postRoomMessage({
        roomId: "lab",
        from: "Gary",
        role: "human",
        text: "who has the numbers?",
        env,
        choose: async () => ({ choice: "grace", probability: 0.91 }),
      });
      assert.equal(routed.route?.kind, "member");
      if (routed.route?.kind === "member") assert.equal(routed.route.botId, "grace");
      assert.equal(routed.key, "room:lab");
      const mentioned = await postRoomMessage({
        roomId: "lab",
        from: "Gary",
        role: "human",
        text: "@Ada the numbers",
        env,
        choose: async () => ({ choice: "grace", probability: 0.99 }),
      });
      if (mentioned.route?.kind === "member") assert.equal(mentioned.route.botId, "ada");
      setPaused(dir, { kind: "bot", id: "grace" }, true);
      const held = await postRoomMessage({
        roomId: "lab",
        from: "Gary",
        role: "human",
        text: "@Grace continue",
        env,
        stateDir: dir,
      });
      assert.equal(held.hold?.code, "bot_held");
      const html = roomPanelHtml("lab");
      assert.match(html ?? "", /Ada \(lead\)/);
      assert.match(html ?? "", /Grace is answering/);
      assert.match(html ?? "", /bot_held|paused|held/i);
      assert.equal(listRoomPanels(env).length, 1);
    } finally {
      if (previous === undefined) delete process.env.SQUIDBOT_ROOMS;
      else process.env.SQUIDBOT_ROOMS = previous;
      resetRooms();
    }
  });

  it("stops a hand-off past depth 4 and a bot that answers itself", async () => {
    resetRooms();
    const env = { SQUIDBOT_ROOMS: "1" };
    openRoom({ id: "lab", title: "Lab", members, env });
    const chain = ["Gary", "Grace", "Ada", "Grace", "Ada"];
    for (let depth = 0; depth < chain.length; depth += 1) {
      const assignee = depth % 2 === 0 ? "Grace" : "Ada";
      const posted = await postRoomMessage({
        roomId: "lab",
        from: chain[depth]!,
        role: "human",
        text: `/assign @${assignee} step ${depth}`,
        env,
      });
      assert.equal(posted.stopped, undefined, posted.stopped);
    }
    const tooDeep = await postRoomMessage({
      roomId: "lab",
      from: "Grace",
      role: "human",
      text: "/assign @Ada past the limit",
      env,
    });
    assert.match(tooDeep.stopped ?? "", /depth/);
    resetRooms();
    openRoom({ id: "loop", title: "Loop", members, env });
    await postRoomMessage({ roomId: "loop", from: "Grace", role: "bot", text: "first", env });
    const looped = await postRoomMessage({ roomId: "loop", from: "Grace", role: "bot", text: "again", env });
    assert.equal(looped.stopped, "loop");
    resetRooms();
  });
});
