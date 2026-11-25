// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: the Control UI desktop viewer and hand-over lease.
import { listDesktopSessions, renderDesktopViewer } from "../../../../src/squidbot/desktop-gateway.ts";
import { desktopsEnabled } from "../../../../src/squidbot/desktops.ts";

function pageEnv(): NodeJS.ProcessEnv {
  if (typeof process !== "undefined" && process.env) return process.env;
  return {};
}

export function renderSolid() {
  const env = pageEnv();
  const sessions = desktopsEnabled(env) ? listDesktopSessions(env) : [];
  return (
    <section class="squidbot-desktops-page">
      <h1>Desktops</h1>
      {desktopsEnabled(env) ? (
        sessions.length > 0 ? (
          sessions.map((session) => <div innerHTML={renderDesktopViewer(session)} />)
        ) : (
          <p>No desktops yet.</p>
        )
      ) : (
        <p>Desktops stay off until SQUIDBOT_DESKTOPS=1.</p>
      )}
    </section>
  );
}
