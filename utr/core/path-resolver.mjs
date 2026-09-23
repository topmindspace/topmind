import { t } from "./i18n-strings.mjs";
import {
  engineRootOf,
  userWorkspaceRootOf,
  userWorkspaceCategoriesRoot,
  inboxRoot,
  archiveRoot,
  categoryRoot,
  topicRoot,
} from "./workspace-context.mjs";

/**
 * Resolve contract args_template and args_extra into a flat argument array.
 *
 * v3.4 variable resolution rules:
 * - {engine_root} → resolved engine root path
 * - {workspace_root} / {user_workspace_root} / {categories_root} → resolved v3.4 user data root
 * - {inbox_root} → resolved buffer role root (e.g. 00-Inbox/)
 * - {archive_root} → resolved 99 Archive/ root
 * - {category_root} → resolved {workspace}/{category} (uses payload.category)
 * - {topic_root} → resolved {workspace}/{category}/{topic} (uses payload.category + payload.topic)
 * - {category} → raw category value (e.g. "20 研究")
 * - {topic} → raw topic value (e.g. "2026-示例记录")
 * - {command} → the command name being executed
 * - {source_path} → resolved workspace-relative source path
 * - {mode} → computed mode (e.g. "preview" or "apply" for dryRun)
 * - {receipt_path} → workspace-relative receipt path
 * - {field_name} → payload field value
 *
 * Adjacent pair rule: When a --flag is followed by a {field} reference,
 * if the field value is undefined/null/empty, BOTH the flag and the value
 * are omitted from the output. Boolean flags (--flag without value) are
 * included only if the payload field is truthy.
 */
export function resolveContractArgs(contract, commandName, pathContext, payload = {}) {
  const cmd = contract.commands[commandName];
  if (!cmd) {
    throw new Error(t("error.commandNotFoundInContract", { kind: contract.kind, command: commandName }));
  }

  const template = contract.execution.args_template || [];
  const extra = cmd.args_extra || [];
  const allTokens = [...template, ...extra];

  return resolveArgTokens(allTokens, commandName, pathContext, payload, cmd, contract.skill);
}

function resolveArgTokens(tokens, commandName, pathContext, payload, cmd, skill) {
  const result = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];

    // Check if this is a --flag {field} pair
    const isFlagPair = token.startsWith("--")
      && nextToken
      && (nextToken.startsWith("{") && nextToken.endsWith("}"));

    if (isFlagPair) {
      const fieldName = nextToken.slice(1, -1);
      const value = resolveFieldValue(fieldName, commandName, pathContext, payload, cmd, skill);

      if (value !== undefined && value !== null && value !== "") {
        result.push(token);
        result.push(String(value));
      }
      // If value is empty/undefined, skip both flag and value
      i += 2;
      continue;
    }

    // Check if this is a standalone --boolean-flag.
    const isBooleanFlag = token.startsWith("--")
      && (!nextToken || nextToken.startsWith("--"));
    if (isBooleanFlag) {
      const flagField = token.slice(2).replace(/-/g, "");
      const fieldDef = cmd.inputs?.[flagField];
      if (fieldDef && fieldDef.type === "toggle") {
        if (payload[flagField]) {
          result.push(token);
        }
      } else {
        const camelKey = token.slice(2).toLowerCase().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        if (payload[camelKey]) {
          result.push(token);
        }
      }
      i += 1;
      continue;
    }

    // Regular token - resolve if it's a variable
    if (token.startsWith("{") && token.endsWith("}")) {
      const varName = token.slice(1, -1);
      const value = resolveFieldValue(varName, commandName, pathContext, payload, cmd, skill);
      if (value !== undefined && value !== null && value !== "") {
        result.push(String(value));
      }
      i += 1;
      continue;
    }

    // Literal token
    result.push(token);
    i += 1;
  }

  return result;
}

function resolveFieldValue(fieldName, commandName, pathContext, payload, cmd, skill) {
  // Path context variables
  switch (fieldName) {
    case "engine_root": {
      return pathContext.engineRoot || engineRootOf(pathContext);
    }
    case "workspace_root":
    case "user_workspace_root":
    case "categories_root":
      return userWorkspaceCategoriesRoot(pathContext);
    case "inbox_root":
      return inboxRoot(pathContext);
    case "archive_root":
      return archiveRoot(pathContext);
    case "command":
      return commandName;
    case "category_root": {
      const category = payload.category || payload.routing?.category;
      if (!category) return undefined;
      return categoryRoot(pathContext, category);
    }
    case "topic_root": {
      const category = payload.category || payload.routing?.category;
      const topic = payload.topic || payload.routing?.topic;
      if (!category || !topic) return undefined;
      return topicRoot(pathContext, category, topic);
    }
    case "category": {
      return payload.category || payload.routing?.category;
    }
    case "topic": {
      return payload.topic || payload.routing?.topic;
    }
    case "source_path": {
      const rawPath = payload.sourcePath || payload.path;
      if (!rawPath) return undefined;
      return resolveWorkspacePath(pathContext, rawPath);
    }
    case "receipt_path": {
      const rawPath = payload.receiptPath;
      if (!rawPath) return undefined;
      return resolveWorkspacePath(pathContext, rawPath);
    }
    case "mode": {
      return payload.dryRun ? "preview" : "apply";
    }
    default:
      break;
  }

  // Payload field lookup
  if (fieldName in payload) {
    const value = payload[fieldName];
    if (value === undefined || value === null) return undefined;
    return value;
  }

  // Nested field lookup (e.g. "routing.category" → payload.routing?.category)
  if (fieldName.includes(".")) {
    const parts = fieldName.split(".");
    let cursor = payload;
    for (const part of parts) {
      if (cursor == null || typeof cursor !== "object") return undefined;
      cursor = cursor[part];
    }
    if (cursor === undefined || cursor === null || cursor === "") return undefined;
    return cursor;
  }

  // Check if there's an input definition with a default
  const inputDef = cmd.inputs?.[fieldName];
  if (inputDef && inputDef.default !== undefined) {
    return inputDef.default;
  }

  return undefined;
}

// Re-export from workspace-context for resolveWorkspacePath consumer use
import { resolveWorkspacePath } from "./workspace-context.mjs";
