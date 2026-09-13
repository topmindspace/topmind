/** Renderer platform for chrome padding (traffic lights / Windows caption overlay). */
export const isMacOS =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
export const isWindows =
  typeof navigator !== "undefined" &&
  (/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent || ""));
