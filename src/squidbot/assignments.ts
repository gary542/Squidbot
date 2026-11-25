// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/runtime/types.ts and server/runtime/handoff-limits.ts @ 96ff8445.
// Modified: one in-memory assignment tree. It does not replace the gateway's subagent registry until SQUIDBOT_ROOMS=1.

export const DEFAULT_LIMITS = {
  depth: 4,
  requests: 24,
  executions: 48,
  wakes: 48,
  totalExecutions: 300,
  failedInARow: 5,
} as const;

export type AssignmentStatus = "queued" | "running" | "needs_input" | "done" | "failed" | "stopped";

export interface Assignment {
  id: string;
  rootId: string;
  parentId?: string;
  depth: number;
  requesterId: string;
  assigneeId: string;
  mode: "work" | "consult" | "notify";
  reply: "resume" | "poll" | "none";
  brief: string;
  status: AssignmentStatus;
  rework?: boolean;
}

export class AssignmentTree {
  readonly records = new Map<string, Assignment>();
  private executions = 0;
  private failedInARow = 0;
  private stopped = false;

  enqueue(input: Omit<Assignment, "id" | "rootId" | "depth" | "status"> & { id?: string; parentId?: string }): Assignment {
    if (this.stopped) throw new Error("This hand-off tree is stopped.");
    if (input.brief.length > 12_000) throw new Error("A brief is at most 12,000 characters.");
    const parent = input.parentId ? this.records.get(input.parentId) : undefined;
    if (input.parentId && !parent) throw new Error("Unknown parent assignment.");
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > DEFAULT_LIMITS.depth) throw new Error(`Hand-off depth stops at ${DEFAULT_LIMITS.depth}.`);
    const rootId = parent?.rootId ?? input.id ?? `asg_${this.records.size + 1}`;
    const same = [...this.records.values()].find(
      (record) =>
        record.parentId === input.parentId &&
        record.assigneeId === input.assigneeId &&
        record.brief === input.brief &&
        !input.rework,
    );
    if (same) return same;
    if (this.executions >= DEFAULT_LIMITS.totalExecutions) {
      this.stopped = true;
      throw new Error(`Hand-off tree stops at ${DEFAULT_LIMITS.totalExecutions} turns.`);
    }
    const record: Assignment = {
      ...input,
      id: input.id ?? `asg_${this.records.size + 1}`,
      rootId,
      depth,
      status: "queued",
      brief: input.brief,
    };
    this.records.set(record.id, record);
    return record;
  }

  start(id: string): Assignment {
    const record = this.require(id);
    if (this.executions >= DEFAULT_LIMITS.totalExecutions) {
      this.stopped = true;
      record.status = "stopped";
      throw new Error(`Hand-off tree stops at ${DEFAULT_LIMITS.totalExecutions} turns.`);
    }
    this.executions += 1;
    record.status = "running";
    return record;
  }

  settle(id: string, status: "done" | "failed" | "needs_input"): Assignment {
    const record = this.require(id);
    record.status = status;
    if (status === "failed") {
      this.failedInARow += 1;
      if (this.failedInARow >= DEFAULT_LIMITS.failedInARow) this.stopped = true;
    } else if (status === "done") {
      this.failedInARow = 0;
    }
    return record;
  }

  get executionCount(): number {
    return this.executions;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  private require(id: string): Assignment {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown assignment ${id}.`);
    return record;
  }
}
