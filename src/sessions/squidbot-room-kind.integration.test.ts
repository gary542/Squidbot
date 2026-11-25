// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: a room session is its own kind only while SQUIDBOT_ROOMS=1.
import { afterEach, describe, expect, it } from "vitest";
import { classifySessionKind } from "./classify-session-kind.js";

const previous = process.env.SQUIDBOT_ROOMS;

afterEach(() => {
  if (previous === undefined) delete process.env.SQUIDBOT_ROOMS;
  else process.env.SQUIDBOT_ROOMS = previous;
});

describe("squidbot room session kind", () => {
  it("classifies room: keys only when rooms are enabled", () => {
    delete process.env.SQUIDBOT_ROOMS;
    expect(classifySessionKind("room:lab")).toBe("direct");
    expect(classifySessionKind("agent:main:main", { chatType: "room" })).toBe("direct");
    process.env.SQUIDBOT_ROOMS = "1";
    expect(classifySessionKind("room:lab")).toBe("room");
    expect(classifySessionKind("agent:main:main", { chatType: "room" })).toBe("room");
    expect(classifySessionKind("agent:main:main", { chatType: "group" })).toBe("group");
  });
});
