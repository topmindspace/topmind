/**
 * Tiny helper for auto-clearing status lines in settings panels.
 */
export function scheduleFlash(
  setMsg: (v: string | null) => void,
  message: string,
  ms = 4000,
): ReturnType<typeof setTimeout> {
  setMsg(message);
  return setTimeout(() => setMsg(null), ms);
}
