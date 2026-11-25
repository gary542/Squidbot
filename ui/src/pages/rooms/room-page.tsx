// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: a basic Control UI list of room members and the room log.
import { renderRoomPanel } from "../../../../src/squidbot/room-view.ts";
import { listRoomPanels, roomsEnabled } from "../../../../src/squidbot/room-gateway.ts";

function pageEnv(): NodeJS.ProcessEnv {
  if (typeof process !== "undefined" && process.env) return process.env;
  return {};
}

export function renderSolid() {
  const env = pageEnv();
  const enabled = roomsEnabled(env);
  const rooms = listRoomPanels(env);
  return (
    <section class="squidbot-room-page">
      <h1>Rooms</h1>
      {enabled ? (
        rooms.length > 0 ? (
          rooms.map((room) => <div innerHTML={renderRoomPanel(room)} />)
        ) : (
          <p>No rooms yet.</p>
        )
      ) : (
        <p>Rooms stay off until SQUIDBOT_ROOMS=1.</p>
      )}
    </section>
  );
}
