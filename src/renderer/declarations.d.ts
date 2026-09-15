declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}

// The preload installs exactly one global. It is optional because the window
// briefly exists before the bridge is attached, and because a renderer loaded
// outside Electron (a test page, a browser) will not have it at all.
//
// This file stays a script rather than a module so the wildcard asset
// declarations above keep working, which is why Window is augmented directly.
interface Window {
  quotaWidget?: import("@shared/ipc-contract").QuotaWidgetApi;
}
