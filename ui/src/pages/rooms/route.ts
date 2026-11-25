// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: lazy route for the room panel.
import { definePage } from "@openclaw/uirouter";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("rooms"),
  component: () =>
    import("./room-page.tsx").then((module) => ({
      renderSolid: module.renderSolid,
    })),
});
