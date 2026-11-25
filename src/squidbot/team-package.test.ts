// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Modified: export scrub and import rollback tests.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createImportStore, exportTeam, importTeamDocument, parseTeamMarkdown } from "./team-package.js";

describe("team packages", () => {
  it("scrubs sk- and ghp_ secrets out of an export", () => {
    const exported = exportTeam({
      name: "Research",
      agents: [{ id: "ada", name: "Ada", instructions: "Use sk-ant-api03-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwxyz123456" }],
      body: "Never print sk-proj-abcdefghijklmnopqrstuvwxyz.",
    });
    assert.equal(exported.markdown.includes("sk-"), false);
    assert.equal(exported.markdown.includes("ghp_"), false);
    assert.match(exported.markdown, /«redacted \d+ chars»/);
    assert.equal(parseTeamMarkdown(exported.markdown).routines.length, 0);
  });

  it("rolls the whole import back when a later record fails", () => {
    const store = createImportStore();
    const markdown = exportTeam({
      name: "Lab",
      agents: [
        { id: "ada", name: "Ada" },
        { id: "grace", name: "Grace" },
      ],
      rooms: [{ id: "lab", name: "Lab" }],
    }).markdown;
    const document = parseTeamMarkdown(markdown);
    document.rooms.push({ id: "", name: "" });
    assert.throws(() => importTeamDocument(store, document));
    assert.equal(store.agents.size, 0);
    assert.equal(store.rooms.size, 0);
  });
});
