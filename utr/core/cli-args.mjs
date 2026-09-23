/**
 * Shared CLI argument parser and mode resolution.
 *
 * 5 UTR tool entry points (workspace-{read,write,check,transform,maintain}.mjs)
 * had identical parseArgs boilerplate (~16 lines each). This helper centralizes
 * the core logic and lets each tool opt into per-key numeric coercion and
 * default-mode resolution.
 */

/**
 * Parse CLI args into a flat object with the first positional as `command`.
 *
 * Supports:
 *   --key value         → args.key = value (string)
 *   --flag              → args.flag = true
 *   positional          → args.command = first positional
 *
 * Options:
 *   defaults        — initial values merged onto the returned object
 *   coerceNumbers   — keys whose string value is coerced to Number
 *   resolveMode     — if true, also run resolveMode(args) and set args.mode
 */
export function parseArgs(argv, { defaults = {}, coerceNumbers = [], resolveMode: shouldResolveMode = false } = {}) {
  const args = { format: "json", ...defaults };
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2).replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      positionals.push(token);
    }
  }

  args.command = positionals[0];

  for (const key of coerceNumbers) {
    if (args[key] !== undefined && args[key] !== true) {
      args[key] = Number(args[key]);
    }
  }

  if (shouldResolveMode) {
    args.mode = resolveMode(args);
  }

  return args;
}

/**
 * Resolve the effective writeback mode for a parsed argv.
 *
 * Precedence (highest → lowest):
 *   1. explicit --mode apply   → "auto" (alias for apply)
 *   2. explicit --mode preview → "preview"
 *   3. explicit --mode auto    → "auto"
 *   4. --dryRun true           → "preview"
 *   5. --writebackMode confirm → "preview"
 *   6. default                 → "auto"
 *
 * Used by workspace-write/transform/maintain to collapse the
 * writebackMode + dryRun + explicit-mode trichotomy to a single token.
 */
export function resolveMode(args) {
  if (args.mode === "apply") return "auto";
  if (args.mode === "preview") return "preview";
  if (args.mode === "auto") return "auto";
  if (args.dryRun === "true" || args.dryRun === true) return "preview";
  if (args.writebackMode === "confirm") return "preview";
  return "auto";
}
