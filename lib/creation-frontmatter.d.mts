export type CreationFrontmatter =
  | { exists: false; valid: true; fields: Record<string, unknown>; bom: string; eol: "\n"; insertOffset: null }
  | { exists: true; valid: true; fields: Record<string, unknown>; bom: string; eol: string; insertOffset: number }
  | { exists: true; valid: false; fields: null; bom: string; reason: "unclosed" | "not-mapping" | "invalid-yaml" };

/** Parse only a complete YAML header. Invalid YAML is reported, never rewritten. */
export function parseCreationFrontmatter(markdown: string): CreationFrontmatter;
