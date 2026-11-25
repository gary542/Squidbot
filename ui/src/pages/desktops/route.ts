// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: lazy route for the desktop viewer.
import { definePage } from "@openclaw/uirouter";
import { routePageSpec } from "../../app-route-paths.ts";

export const page = definePage({
  ...routePageSpec("desktops"),
  component: () =>
    import("./desktops-page.tsx").then((module) => ({
      renderSolid: module.renderSolid,
    })),
});
