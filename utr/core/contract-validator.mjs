import { t } from "./i18n-strings.mjs";

const CATEGORY_PATTERN = /^[\p{L}\p{N} _\u4e00-\u9fff-]+$/u;
const TOPIC_PATTERN = /^[\p{L}\p{N}._\- \u4e00-\u9fff]+$/u;

/**
 * Validate a payload against a command's input definitions.
 * Returns an array of error messages. Empty array means valid.
 */
export function validateCommandPayload(command, payload = {}) {
  const errors = [];
  const inputs = command.inputs || {};

  // v3.4: routing is a paired category+topic object
  if (payload.routing && typeof payload.routing === "object") {
    const routingErrors = validateRouting(payload.routing, inputs);
    errors.push(...routingErrors);
  }

  for (const [fieldName, fieldDef] of Object.entries(inputs)) {
    // routing 已统一处理
    if (fieldName === "routing") continue;

    const value = payload[fieldName];

    // Check required fields
    if (fieldDef.required) {
      if (value === undefined || value === null || value === "") {
        errors.push(t("error.missingRequiredParam", { label: fieldDef.label || fieldName }));
        continue;
      }
    }

    // Skip further validation if no value provided (and not required)
    if (value === undefined || value === null || value === "") continue;

    // Type-specific validation
    switch (fieldDef.type) {
      case "select":
        if (fieldDef.options && !fieldDef.options.some((o) => o.value === value)) {
          errors.push(t("error.invalidSelectValue", { label: fieldDef.label || fieldName, value, allowed: fieldDef.options.map((o) => o.value).join(", ") }));
        }
        break;

      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          errors.push(t("error.mustBeNumber", { label: fieldDef.label || fieldName }));
        } else if (fieldDef.min !== undefined && value < fieldDef.min) {
          errors.push(t("error.minValue", { label: fieldDef.label || fieldName, min: fieldDef.min }));
        } else if (fieldDef.max !== undefined && value > fieldDef.max) {
          errors.push(t("error.maxValue", { label: fieldDef.label || fieldName, max: fieldDef.max }));
        }
        break;

      case "toggle":
        // Toggle values are booleans; coerce truthy/falsy
        break;

      case "category":
        if (typeof value !== "string" || !CATEGORY_PATTERN.test(value)) {
          errors.push(t("error.invalidCategoryPattern", { label: fieldDef.label || fieldName }));
        }
        break;

      case "topic":
        if (typeof value !== "string" || !TOPIC_PATTERN.test(value)) {
          errors.push(t("error.invalidTopicPattern", { label: fieldDef.label || fieldName }));
        }
        break;

      case "category-and-topic":
        // 已在 routing 路径处理
        break;

      case "text":
      case "textarea":
      case "csv":
      case "path":
        if (typeof value !== "string") {
          errors.push(t("error.mustBeText", { label: fieldDef.label || fieldName }));
        }
        break;
    }

    // Check mustBeTrue
    if (fieldDef.mustBeTrue && value !== true) {
      errors.push(t("error.mustBeConfirmed", { label: fieldDef.label || fieldName }));
    }
  }

  return errors;
}

function validateRouting(routing, inputs) {
  const errors = [];
  if (routing.category === undefined || routing.category === null || routing.category === "") {
    errors.push(t("error.missingRoutingCategory"));
  } else if (typeof routing.category !== "string" || !CATEGORY_PATTERN.test(routing.category)) {
    errors.push(t("error.invalidRoutingCategory"));
  }
  if (routing.topic !== undefined && routing.topic !== null && routing.topic !== "") {
    if (typeof routing.topic !== "string" || !TOPIC_PATTERN.test(routing.topic)) {
      errors.push(t("error.invalidRoutingTopic"));
    }
  }
  return errors;
}

/**
 * Normalize a raw payload against a command's input definitions.
 * Coerces types, applies defaults, and trims strings.
 */
export function normalizeCommandPayload(command, rawPayload = {}) {
  const normalized = { ...rawPayload };
  const inputs = command.inputs || {};

  // Always normalize kind and command
  if (rawPayload.kind) normalized.kind = String(rawPayload.kind).trim();
  if (rawPayload.command) normalized.command = String(rawPayload.command).trim();

  // v3.4: trim nested routing fields (category-and-topic)
  if (rawPayload.routing && typeof rawPayload.routing === "object") {
    normalized.routing = { ...rawPayload.routing };
    if (typeof normalized.routing.category === "string") {
      normalized.routing.category = normalized.routing.category.trim();
    }
    if (typeof normalized.routing.topic === "string") {
      normalized.routing.topic = normalized.routing.topic.trim();
    }
  }

  for (const [fieldName, fieldDef] of Object.entries(inputs)) {
    if (!(fieldName in normalized)) {
      if (fieldDef.default !== undefined) {
        normalized[fieldName] = fieldDef.default;
      }
      continue;
    }

    const value = normalized[fieldName];

    switch (fieldDef.type) {
      case "text":
      case "textarea":
      case "path":
      case "csv":
      case "category":
      case "topic":
      case "category-and-topic":
        if (typeof value === "string") {
          normalized[fieldName] = value.trim();
        } else if (value !== undefined && value !== null && typeof value !== "object") {
          normalized[fieldName] = String(value).trim();
        }
        break;

      case "number":
        if (typeof value !== "number") {
          const parsed = Number(value);
          normalized[fieldName] = Number.isFinite(parsed) ? parsed : undefined;
        }
        break;

      case "toggle":
        normalized[fieldName] = Boolean(value);
        break;

      case "select":
        // Keep as-is; validation will catch invalid values
        break;
    }
  }

  // Normalize path-like fields: backslash to forward slash
  for (const key of ["sourcePath", "path", "target"]) {
    if (typeof normalized[key] === "string") {
      normalized[key] = normalized[key].replaceAll("\\", "/").replace(/^\/+/u, "").trim();
    }
  }

  // Normalize boolean aliases
  for (const key of ["reviewed", "create", "fix", "dryRun", "overwrite", "force"]) {
    if (key in normalized && typeof normalized[key] !== "boolean") {
      normalized[key] = Boolean(normalized[key]);
    }
  }

  return normalized;
}
