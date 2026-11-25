// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/package-import.ts, shared/redact.ts, teams FORMAT @ 96ff8445.
// Modified: Squidbot team Markdown (compatible with BotMRR v2 fields). Import adds records and rolls back. No hosted publish.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactSecretsInText } from "./redact.js";

export interface TeamAgent {
  id: string;
  name: string;
  title?: string;
  instructions?: string;
  skills?: string[];
  chief?: boolean;
}

export interface TeamRoom {
  id: string;
  name: string;
  defaultResponder?: string;
  members?: string[];
}

export interface TeamRoutine {
  id: string;
  name: string;
  schedule?: string;
  enabledAfterInstall: false;
}

export interface TeamDocument {
  botmrr: 2;
  name: string;
  tagline?: string;
  summary?: string;
  agents: TeamAgent[];
  rooms: TeamRoom[];
  routines: TeamRoutine[];
  body: string;
}

export interface InstalledTeam {
  agents: TeamAgent[];
  rooms: TeamRoom[];
  routines: TeamRoutine[];
}

const SECRET_FILE = /(^|\/)\.env($|\.)|id_rsa|credentials|secret|token/i;

export function scrubExportText(text: string): { text: string; redactions: number } {
  const before = text;
  const textOut = redactSecretsInText(text);
  const redactions = before === textOut ? 0 : (textOut.match(/«redacted \d+ chars»/g) ?? []).length;
  return { text: textOut, redactions };
}

/** Drop privilege fields. The file never chooses models, approvals, computers, or secrets. */
export function exportTeam(input: {
  name: string;
  tagline?: string;
  summary?: string;
  agents: Array<TeamAgent & Record<string, unknown>>;
  rooms?: TeamRoom[];
  routines?: Array<TeamRoutine & { enabled?: boolean }>;
  body?: string;
}): { markdown: string; redactions: number } {
  const agents = input.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    ...(agent.title ? { title: agent.title } : {}),
    ...(agent.instructions ? { instructions: agent.instructions } : {}),
    ...(agent.skills ? { skills: agent.skills } : {}),
    ...(agent.chief ? { chief: true } : {}),
  }));
  const routines = (input.routines ?? []).map((routine) => ({
    id: routine.id,
    name: routine.name,
    ...(routine.schedule ? { schedule: routine.schedule } : {}),
    enabledAfterInstall: false as const,
  }));
  const document = {
    botmrr: 2,
    name: input.name,
    tagline: input.tagline ?? "",
    summary: input.summary ?? "",
    agents,
    rooms: input.rooms ?? [],
    routines,
  };
  const raw = `---\n${JSON.stringify(document, null, 2)}\n---\n\n${input.body ?? ""}\n`;
  return { ...scrubExportText(raw), markdown: scrubExportText(raw).text };
}

export function parseTeamMarkdown(markdown: string): TeamDocument {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(markdown.trim());
  if (!match) throw new Error("A team file needs YAML frontmatter.");
  let front: unknown;
  try {
    front = JSON.parse(match[1] ?? "");
  } catch {
    throw new Error("Team frontmatter must be JSON (BotMRR v2 fields).");
  }
  if (!front || typeof front !== "object") throw new Error("Team frontmatter must be an object.");
  const row = front as Partial<TeamDocument>;
  if (row.botmrr !== 2) throw new Error("Only botmrr: 2 team files import.");
  if (typeof row.name !== "string" || !row.name.trim()) throw new Error("A team needs a name.");
  if (!Array.isArray(row.agents) || row.agents.length === 0) throw new Error("A team needs at least one agent.");
  const routines = Array.isArray(row.routines) ? row.routines : [];
  for (const routine of routines) {
    if (!routine || routine.enabledAfterInstall !== false) {
      throw new Error("Routines must say enabledAfterInstall: false.");
    }
  }
  return {
    botmrr: 2,
    name: row.name,
    tagline: row.tagline,
    summary: row.summary,
    agents: row.agents,
    rooms: Array.isArray(row.rooms) ? row.rooms : [],
    routines,
    body: match[2] ?? "",
  };
}

export interface ImportStore {
  agents: Map<string, TeamAgent>;
  rooms: Map<string, TeamRoom>;
  routines: Map<string, TeamRoutine>;
}

export function createImportStore(): ImportStore {
  return { agents: new Map(), rooms: new Map(), routines: new Map() };
}

/** Adds new records only. Any failure removes everything this import added. */
export function importTeamDocument(store: ImportStore, document: TeamDocument, takenNames: Set<string> = new Set()): InstalledTeam {
  const added: InstalledTeam = { agents: [], rooms: [], routines: [] };
  const rollback = () => {
    for (const agent of added.agents) store.agents.delete(agent.id);
    for (const room of added.rooms) store.rooms.delete(room.id);
    for (const routine of added.routines) store.routines.delete(routine.id);
  };
  try {
    for (const agent of document.agents) {
      if (!agent.id || !agent.name) throw new Error("Each agent needs an id and a name.");
      let name = agent.name;
      let n = 2;
      while (takenNames.has(name) || [...store.agents.values()].some((existing) => existing.name === name)) {
        name = `${agent.name} ${n}`;
        n += 1;
      }
      if (store.agents.has(agent.id)) throw new Error(`Agent ${agent.id} already exists.`);
      const record: TeamAgent = { ...agent, name };
      store.agents.set(agent.id, record);
      takenNames.add(name);
      added.agents.push(record);
    }
    for (const room of document.rooms) {
      if (!room.id || !room.name) throw new Error("Each room needs an id and a name.");
      if (store.rooms.has(room.id)) throw new Error(`Room ${room.id} already exists.`);
      store.rooms.set(room.id, room);
      added.rooms.push(room);
    }
    for (const routine of document.routines) {
      if (routine.enabledAfterInstall !== false) throw new Error("Routines stay paused until the owner enables them.");
      if (store.routines.has(routine.id)) throw new Error(`Routine ${routine.id} already exists.`);
      store.routines.set(routine.id, routine);
      added.routines.push(routine);
    }
    return added;
  } catch (error) {
    rollback();
    throw error;
  }
}

export function assertSkillFileAllowed(relativePath: string, bytes: number): void {
  if (relativePath.split("/").length > 6) throw new Error(`${relativePath} is nested too deeply.`);
  if (SECRET_FILE.test(relativePath) || path.basename(relativePath).startsWith(".")) {
    throw new Error(`${relativePath} looks like a secret or hidden file and is left out.`);
  }
  if (bytes > 128 * 1024) throw new Error(`${relativePath} is larger than 128 KB.`);
}

export function writeExportFolder(dir: string, markdown: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "team.md"), markdown);
}

export function readExportFolder(dir: string): string {
  const team = path.join(dir, "team.md");
  const bot = path.join(dir, "bot.md");
  const hasTeam = exists(team);
  const hasBot = exists(bot);
  if (hasTeam === hasBot) throw new Error("A template folder needs exactly one of team.md or bot.md.");
  for (const entry of readdirSync(dir)) {
    if (!["team.md", "bot.md", "skills", "avatars", "README.md"].includes(entry)) {
      throw new Error(`${entry} is not allowed in a template folder.`);
    }
  }
  return readFileSync(hasTeam ? team : bot, "utf8");
}

function exists(file: string): boolean {
  try {
    readFileSync(file);
    return true;
  } catch {
    return false;
  }
}

export function removeExportFolder(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
