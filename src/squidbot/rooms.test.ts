// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: room routing and assignment-tree limit tests.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AssignmentTree, DEFAULT_LIMITS } from "./assignments.js";
import { EVERYONE_OPTION, ROOM_ROUTING_MIN_PROBABILITY, ROOM_ROUTING_TIMEOUT_MS, decideRoomResponder } from "./rooms.js";

const members = [
  { id: "ada", name: "Ada", lead: true },
  { id: "grace", name: "Grace" },
];

describe("rooms and delegation", () => {
  it("picks a member at or above 0.6 and otherwise the room lead", async () => {
    assert.equal(ROOM_ROUTING_MIN_PROBABILITY, 0.6);
    assert.equal(ROOM_ROUTING_TIMEOUT_MS, 1500);
    const chosen = await decideRoomResponder(
      { room: "Lab", humans: ["Gary"], members, recent: [], message: { from: "Gary", text: "Ada, the numbers" } },
      async () => ({ choice: "ada", probability: 0.92 }),
    );
    assert.deepEqual(chosen, { kind: "member", botId: "ada", probability: 0.92 });
    const low = await decideRoomResponder(
      { room: "Lab", humans: ["Gary"], members, recent: [], message: { from: "Gary", text: "hello" } },
      async () => ({ choice: "grace", probability: 0.4 }),
    );
    assert.equal(low.kind, "fallback");
    if (low.kind === "fallback") assert.equal(low.botId, "ada");
    const everyone = await decideRoomResponder(
      { room: "Lab", humans: ["Gary"], members, recent: [], message: { from: "Gary", text: "everyone weigh in" } },
      async () => ({ choice: EVERYONE_OPTION, probability: 0.8 }),
    );
    assert.equal(everyone.kind, "everyone");
    const slow = await decideRoomResponder(
      { room: "Lab", humans: ["Gary"], members, recent: [], message: { from: "Gary", text: "status" } },
      () => new Promise(() => {}),
      { timeoutMs: 20 },
    );
    assert.equal(slow.kind, "fallback");
    if (slow.kind === "fallback") assert.equal(slow.reason, "timeout");
  });

  it("stops a hand-off tree at depth 4 and at 300 turns", () => {
    const tree = new AssignmentTree();
    let parent: string | undefined;
    for (let depth = 0; depth <= DEFAULT_LIMITS.depth; depth += 1) {
      const record = tree.enqueue({
        parentId: parent,
        requesterId: parent ? "bot" : "person",
        assigneeId: `bot-${depth}`,
        mode: "work",
        reply: "resume",
        brief: `step ${depth}`,
      });
      parent = record.id;
    }
    assert.throws(() =>
      tree.enqueue({
        parentId: parent,
        requesterId: "bot",
        assigneeId: "too-deep",
        mode: "work",
        reply: "resume",
        brief: "past the limit",
      }),
    );
    const wide = new AssignmentTree();
    for (let index = 0; index < DEFAULT_LIMITS.totalExecutions; index += 1) {
      const record = wide.enqueue({
        requesterId: "person",
        assigneeId: "worker",
        mode: "work",
        reply: "none",
        brief: `turn ${index}`,
        rework: true,
      });
      wide.start(record.id);
    }
    assert.throws(() =>
      wide.enqueue({
        requesterId: "person",
        assigneeId: "worker",
        mode: "work",
        reply: "none",
        brief: "one more",
        rework: true,
      }),
    );
  });
});
