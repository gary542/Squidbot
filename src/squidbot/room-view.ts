// Adapted from milind-soni/OpenMausBot (Apache-2.0), modified for Squidbot.
// Upstream: the room transcript in the Control UI @ 96ff8445.
// Modified: a small HTML panel of members and the room log. The page stays off until SQUIDBOT_ROOMS=1.

export interface RoomPanel {
  id: string;
  key: string;
  title: string;
  members: Array<{ id: string; name: string; lead: boolean }>;
  messages: Array<{ from: string; role: "human" | "bot" | "system"; text: string }>;
  stopped?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The Control UI room page renders this panel. */
export function renderRoomPanel(room: RoomPanel): string {
  const members = room.members
    .map((member) => `<li>${escapeHtml(member.name)}${member.lead ? " (lead)" : ""}</li>`)
    .join("");
  const messages = room.messages
    .map(
      (message) =>
        `<li data-role="${message.role}"><strong>${escapeHtml(message.from)}</strong> ${escapeHtml(message.text)}</li>`,
    )
    .join("");
  const stopped = room.stopped ? `<p class="squidbot-room-stopped">${escapeHtml(room.stopped)}</p>` : "";
  return `<section class="squidbot-room" data-room="${escapeHtml(room.id)}" data-session="${escapeHtml(room.key)}"><h2>${escapeHtml(room.title)}</h2><ul class="squidbot-room-members">${members}</ul><ol class="squidbot-room-log">${messages}</ol>${stopped}</section>`;
}
