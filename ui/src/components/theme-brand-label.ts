// Adapted from openclaw/openclaw (MIT), modified for Squidbot.
// Modified: Squidbot uses the product ask-label.
import { currentThemeBranding } from "../app/theme-branding.ts";
import { t } from "../i18n/index.ts";

export function askBrandLabel(translate: typeof t = t): string {
  const brand = currentThemeBranding().brandName;
  return brand === "OpenClaw" || brand === "Squidbot"
    ? translate("nav.askOpenClaw")
    : translate("nav.askBrand", { brand });
}
