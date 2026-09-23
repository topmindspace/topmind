const RESULT_FENCE = /```topmind-result\s*\n([\s\S]*?)\n```/u;

export function parseToolOutput(stdout) {
  const raw = String(stdout || "").trim();
  const fenceMatch = raw.match(RESULT_FENCE);
  if (fenceMatch) {
    try {
      return { parsed: JSON.parse(fenceMatch[1]), raw, format: "topmind-result" };
    } catch {
      return { parsed: null, raw, format: "text" };
    }
  }

  try {
    return { parsed: JSON.parse(raw), raw, format: "json" };
  } catch {
    return { parsed: null, raw, format: "text" };
  }
}

export function unwrapToolData(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "data")) {
    return parsed.data;
  }
  return parsed;
}

export function buildResultEnvelope({
  ok,
  kind,
  command,
  data = null,
  receipt = null,
  generatedAt = new Date().toISOString(),
  errors = [],
  metadata = {},
} = {}) {
  return {
    ok: ok === true,
    generatedAt,
    kind: kind || "",
    command: command || "",
    data,
    receipt,
    errors: Array.isArray(errors) ? errors : [String(errors)],
    metadata,
  };
}

export function emitResult(data, outputFormat = "json") {
  if (outputFormat === "json") {
    console.log("```topmind-result");
    console.log(JSON.stringify({ data }, null, 2));
    console.log("```");
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}
