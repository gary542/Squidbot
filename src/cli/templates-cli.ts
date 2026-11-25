// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: export and import scrubbed multi-agent team files.
import type { Command } from "commander";
import { applyParentDefaultHelpAction } from "./program/parent-default-help.js";

export type TemplatesInspectOptions = {
  json?: boolean;
};

export type TemplatesCreateOptions = TemplatesInspectOptions & {
  name?: string;
  agentId?: string;
};
export type TemplatesDraftOptions = { json?: boolean };
export type TemplatesValidateOptions = { json?: boolean };
export type TemplatesBuildOptions = { out: string; json?: boolean };
export type TemplatesDevOptions = { agentId?: string; workspace?: string; json?: boolean };

export type TemplatesAddOptions = TemplatesDevOptions & {
  dryRun?: boolean;
  acceptCapabilities?: boolean;
  acknowledgeClawhubRisk?: boolean;
};
export function registerTemplatesCli(program: Command) {
  const templates = program.command("templates").description("Author and add OpenClaw Templates");

  templates
    .command("create")
    .description("Create a minimal local Template project")
    .argument("[path]", "New project directory", ".")
    .option("--name <name>", "Set the package name")
    .option("--agent-id <id>", "Set the portable agent id")
    .option("--json", "Print JSON", false)
    .action(async (path: string, opts: TemplatesCreateOptions) => {
      const { runTemplatesCreateCommand } = await import("./templates-cli.project.js");
      await runTemplatesCreateCommand(path, opts);
    });

  templates
    .command("draft")
    .description("Prepare a private Template draft without publishing")
    .argument("<workspace>", "Agent workspace for the private draft")
    .option("--json", "Print JSON", false)
    .action(async (workspace: string, opts: TemplatesDraftOptions) => {
      const { runTemplatesDraftCommand } = await import("./templates-cli.project.js");
      await runTemplatesDraftCommand(workspace, opts);
    });

  templates
    .command("validate")
    .description("Validate a local Template project")
    .argument("[path]", "Project directory", ".")
    .option("--json", "Print JSON", false)
    .action(async (path: string, opts: TemplatesValidateOptions) => {
      const { runTemplatesValidateCommand } = await import("./templates-cli.project.js");
      await runTemplatesValidateCommand(path, opts);
    });

  templates
    .command("dev")
    .description("Build and preview a local Template without network or mutation")
    .argument("[path]", "Project directory", ".")
    .option("--agent-id <id>", "Preview with an unused local agent id")
    .option("--workspace <path>", "Preview with a new workspace path")
    .option("--json", "Print JSON", false)
    .action(async (path: string, opts: TemplatesDevOptions) => {
      const { runTemplatesDevCommand } = await import("./templates-cli.project.js");
      await runTemplatesDevCommand(path, opts);
    });

  templates
    .command("build")
    .description("Build a reproducible Template package artifact")
    .argument("[path]", "Project directory", ".")
    .requiredOption("--out <artifact>", "New .tgz artifact to create")
    .option("--json", "Print JSON", false)
    .action(async (path: string, opts: TemplatesBuildOptions) => {
      const { runTemplatesBuildCommand } = await import("./templates-cli.project.js");
      await runTemplatesBuildCommand(path, opts);
    });

  templates
    .command("inspect")
    .description("Validate a Template package or local development manifest")
    .argument("<source>", "Path to a canonical Template package directory or CLAW.md")
    .option("--json", "Print JSON", false)
    .action(async (source: string, opts: TemplatesInspectOptions) => {
      const { runTemplatesInspectCommand } = await import("./templates-cli.runtime.js");
      await runTemplatesInspectCommand(source, opts);
    });

  templates
    .command("add")
    .description("Add a new agent and its requirements from a Template")
    .argument("<source>", "ClawHub Template (@publisher/slug), local package directory, or CLAW.md")
    .option("--dry-run", "Preview all actions without mutating state", false)
    .option("--accept-capabilities", "Accept required plugin capabilities", false)
    .option("--acknowledge-clawhub-risk", "Acknowledge ClawHub trust warnings", false)
    .option("--agent-id <id>", "Override the requested id with an unused local agent id")
    .option("--workspace <path>", "Override the derived new workspace path")
    .option("--json", "Print JSON", false)
    .action(async (source: string, opts: TemplatesAddOptions) => {
      const { runTemplatesAddCommand } = await import("./templates-cli.runtime.js");
      await runTemplatesAddCommand(source, opts);
    });

  templates
    .command("export")
    .description("Export a Squidbot team file with secrets scrubbed")
    .requiredOption("--name <name>", "Team name")
    .requiredOption("--agent <name>", "Agent name", "Main")
    .option("--instructions <text>", "Agent instructions", "")
    .option("--out <file>", "Write team.md here")
    .action(async (opts: { name: string; agent: string; instructions: string; out?: string }) => {
      const { exportTeamMarkdown, writeExportFolder } = await import("../squidbot/commands.js");
      const { writeFileSync } = await import("node:fs");
      const exported = exportTeamMarkdown({
        name: opts.name,
        agents: [{ id: "main", name: opts.agent, instructions: opts.instructions }],
      });
      if (opts.out) {
        if (opts.out.endsWith(".md")) writeFileSync(opts.out, exported.markdown);
        else writeExportFolder(opts.out, exported.markdown);
      }
      process.stdout.write(`${JSON.stringify({ redactions: exported.redactions, markdown: exported.markdown })}\n`);
    });

  templates
    .command("import")
    .description("Import a scrubbed Squidbot team file (new records only, rolls back on failure)")
    .argument("<file>", "team.md to read")
    .action(async (file: string) => {
      const { readFileSync } = await import("node:fs");
      const { importTeamMarkdown } = await import("../squidbot/commands.js");
      const installed = importTeamMarkdown(readFileSync(file, "utf8"));
      process.stdout.write(`${JSON.stringify({ agents: installed.agents.length, rooms: installed.rooms.length })}\n`);
    });

  applyParentDefaultHelpAction(templates);
}
