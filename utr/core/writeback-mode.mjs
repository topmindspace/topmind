/**
 * UTR writeback mode resolution — contract is auto | confirm only.
 * Legacy "batch" is NOT a supported third mode (no silent batch→auto map).
 */

export const WRITEBACK_MODES = Object.freeze(["auto", "confirm"]);

/**
 * @param {object} [input]
 * @param {unknown} [input.payloadMode] - payload.writebackMode when present
 * @param {boolean} [input.payloadHasMode] - whether payload owns the key
 * @param {unknown} [input.optionMode] - executeTool options.writebackMode
 * @param {unknown} [input.envMode] - process.env.topmind_WRITEBACK_MODE
 * @returns {{ ok: true, mode: "auto"|"confirm" } | { ok: false, mode: null, error: string, raw: string }}
 */
export function resolveWritebackModeInput({
  payloadMode,
  payloadHasMode = false,
  optionMode,
  envMode,
} = {}) {
  const allowed = new Set(WRITEBACK_MODES);
  let raw = "";
  let source = "default";

  const payloadStr =
    payloadHasMode && payloadMode != null ? String(payloadMode).trim() : "";
  if (payloadStr) {
    raw = payloadStr;
    source = "payload";
  } else {
    const opt = optionMode != null ? String(optionMode).trim() : "";
    const env = envMode != null ? String(envMode).trim() : "";
    if (opt) {
      raw = opt;
      source = "option";
    } else if (env) {
      raw = env;
      source = "env";
    }
  }

  if (!raw) {
    return { ok: true, mode: "auto" };
  }
  if (allowed.has(raw)) {
    return { ok: true, mode: /** @type {"auto"|"confirm"} */ (raw) };
  }
  return {
    ok: false,
    mode: null,
    raw,
    error: `Invalid writebackMode "${raw}" from ${source} (allowed: auto|confirm; batch is not supported)`,
  };
}
