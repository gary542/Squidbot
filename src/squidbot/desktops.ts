// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: server/computer-control.ts and server/computer-selection.ts @ 96ff8445.
// Modified: in-memory take-control lease. Live Podman and VPS desktops stay behind SQUIDBOT_DESKTOPS=1.

export type DesktopPlace = "container" | "ssh" | "host" | "boat";

export function desktopsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SQUIDBOT_DESKTOPS === "1";
}

export interface DesktopChoice {
  place: DesktopPlace | null;
  reason: string;
}

/** The person's choice wins. Otherwise keep the current ready place. Never move work on the bot's own. */
export function pickComputer(input: {
  requested?: DesktopPlace;
  current?: DesktopPlace;
  ready: readonly DesktopPlace[];
}): DesktopChoice {
  if (input.requested && input.ready.includes(input.requested)) {
    return { place: input.requested, reason: "person" };
  }
  if (input.requested && !input.ready.includes(input.requested)) {
    return { place: input.current && input.ready.includes(input.current) ? input.current : null, reason: "requested-unavailable" };
  }
  if (input.current && input.ready.includes(input.current)) return { place: input.current, reason: "current" };
  if (input.ready.includes("container")) return { place: "container", reason: "local-vm" };
  return { place: input.ready[0] ?? null, reason: input.ready[0] ? "ready" : "none" };
}

export class TakeControlLease {
  private holder: "person" | null = null;

  take(): void {
    this.holder = "person";
  }

  release(): void {
    this.holder = null;
  }

  personHolds(): boolean {
    return this.holder === "person";
  }

  /** Bot actions are refused while a person holds, never queued. */
  botMayAct(): { allowed: boolean; reason: string } {
    if (this.holder === "person") return { allowed: false, reason: "person holds the computer" };
    return { allowed: true, reason: "bot" };
  }

  viewerMayInput(): boolean {
    return this.holder === "person";
  }
}
