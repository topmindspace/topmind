function splitLines(data = {}) {
  return Object.entries(data).map(([key, value]) => `${key}: ${value}`);
}

export function parseFrontmatter(text) {
  const source = String(text || "");
  const leadingMatch = source.match(/^\s*/u);
  const leading = leadingMatch?.[0] || "";
  const content = source.slice(leading.length);

  if (!content.startsWith("---\n")) {
    return { data: {}, body: source, leading, hasFrontmatter: false };
  }

  const end = content.indexOf("\n---\n", 4);
  if (end === -1) {
    return { data: {}, body: source, leading, hasFrontmatter: false };
  }

  const data = {};
  for (const rawLine of content.slice(4, end).split(/\r?\n/u)) {
    if (!rawLine.includes(":")) continue;
    const [key, ...valueParts] = rawLine.split(":");
    data[key.trim()] = valueParts.join(":").trim().replace(/^['"]|['"]$/gu, "");
  }

  return {
    data,
    body: content.slice(end + "\n---\n".length),
    leading,
    hasFrontmatter: true,
  };
}

export function stringifyFrontmatter({ data = {}, body = "", leading = "" } = {}) {
  const lines = splitLines(data);
  return `${leading}---\n${lines.join("\n")}\n---\n${String(body || "")}`;
}

export function setFrontmatterField(text, key, value) {
  const parsed = parseFrontmatter(text);
  return stringifyFrontmatter({
    data: { ...parsed.data, [key]: value },
    body: parsed.hasFrontmatter ? parsed.body : String(text || ""),
    leading: parsed.hasFrontmatter ? parsed.leading : "",
  });
}

export function touchUpdatedFrontmatter(text, timestamp = new Date().toISOString()) {
  const parsed = parseFrontmatter(text);
  const data = { ...parsed.data };
  if (Object.prototype.hasOwnProperty.call(data, "updated")) {
    data.updated = timestamp;
  } else if (Object.prototype.hasOwnProperty.call(data, "updated_at")) {
    data.updated_at = timestamp;
  } else {
    data.updated_at = timestamp;
  }

  return stringifyFrontmatter({
    data,
    body: parsed.hasFrontmatter ? parsed.body : String(text || ""),
    leading: parsed.hasFrontmatter ? parsed.leading : "",
  });
}
