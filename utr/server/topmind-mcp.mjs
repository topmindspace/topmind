#!/usr/bin/env node

/**
 * topmind MCP Server — Model Context Protocol interface for UTR tools.
 *
 * Exposes all contract commands as MCP tools over stdio JSON-RPC.
 * AI models call tools directly via MCP, bypassing the Electron IPC layer.
 *
 * Usage:
 *   node utr/server/topmind-mcp.mjs [--engine-root <path>] [--workspace-root <path>]
 *
 * Phase 3: Direct MCP integration.
 */

import { createInterface } from "node:readline";
import { resolveUtrWorkspaceContext, loadWorkspaceConfig } from "../core/workspace-context.mjs";
import { t, setLocaleFromConfig } from "../core/i18n-strings.mjs";
import { loadContractRegistry, getCommand } from "../core/contract-registry.mjs";
import { executeTool, previewTool } from "../core/tool-executor.mjs";
import { normalizeCommandPayload, validateCommandPayload } from "../core/contract-validator.mjs";
import { resolveWritebackModeInput } from "../core/writeback-mode.mjs";
import { buildMcpToolList } from "./tool-mapper.mjs";
import {
  createReviewSession,
  consumeReviewSession,
  formatReviewResponse,
  formatToolResult,
  cleanupExpiredSessions,
} from "./review-session-handler.mjs";

// ── Server identity ───────────────────────────────────────────────────────

const SERVER_INFO = {
  name: "topmind-mcp",
  version: "1.0.0",
};

const PROTOCOL_VERSION = "2024-11-05";

// ── Path context (auto-detected or from args) ─────────────────────────────

let pathContext = null;

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--engine-root" && argv[i + 1]) {
      parsed.engineRoot = argv[i + 1];
      i++;
    } else if (argv[i] === "--workspace-root" && argv[i + 1]) {
      parsed.userWorkspaceRoot = argv[i + 1];
      i++;
    }
  }
  return parsed;
}

// ── JSON-RPC transport ────────────────────────────────────────────────────

function sendResponse(id, result) {
  // Notifications have no id — don't respond
  if (id === undefined || id === null) return;
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    result,
  }) + "\n");
}

function sendError(id, code, message) {
  // Notifications have no id — don't respond
  if (id === undefined || id === null) return;
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  }) + "\n");
}

// ── Request handlers ──────────────────────────────────────────────────────

let registry = null;
let registryLoading = null;

async function ensureRegistry() {
  if (registry) return registry;
  if (registryLoading) return registryLoading;
  registryLoading = loadContractRegistry({ engineRoot: pathContext?.engineRoot }).then((r) => { registry = r; return r; });
  return registryLoading;
}

import { checkReviewRequired } from "../core/review-policy.mjs";

async function handleInitialize(id, params) {
  await ensureRegistry();

  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},
      // Advertise that we support review sessions via the _reviewed/_sessionId pattern.
      experimental: {
        reviewSession: true,
        reviewPattern: "Two-phase: first call returns review_required with sessionId, second call with _reviewed and _sessionId executes",
      },
    },
    serverInfo: SERVER_INFO,
  };
}

async function handleToolsList(id) {
  await ensureRegistry();

  const tools = buildMcpToolList(registry);
  return { tools };
}

async function handleToolsCall(id, params) {
  await ensureRegistry();

  const { name, arguments: args = {} } = params || {};

  // Check for review-session replay.
  if (args._reviewed && args._sessionId) {
    const session = await consumeReviewSession(args._sessionId);
    if (!session) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ status: "error", message: t("error.reviewSessionExpired") }),
        }],
        isError: true,
      };
    }

    // Execute the reviewed tool.
    const result = await executeTool({
      registry,
      kind: session.kind,
      command: session.command,
      payload: { ...session.payload, reviewed: true },
      pathContext,
      reviewed: true,
    });

    return formatToolResult(result);
  }

  // Parse tool name: "{kind}.{command}"
  const dotIndex = name.indexOf(".");
  if (dotIndex === -1) {
    return {
      content: [{ type: "text", text: t("error.invalidToolName", { name }) }],
      isError: true,
    };
  }

  const kind = name.substring(0, dotIndex);
  const command = name.substring(dotIndex + 1);

  // Validate payload against contract
  let cmdDef;
  try {
    const entry = getCommand(registry, kind, command);
    cmdDef = entry.command;
  } catch {
    return {
      content: [{ type: "text", text: t("error.unknownOperationName", { name }) }],
      isError: true,
    };
  }

  const payloadHasDryRun = Object.prototype.hasOwnProperty.call(args, "dryRun");
  // auto | confirm only — reject batch / unknown (no silent compat map)
  const modeResolution = resolveWritebackModeInput({
    payloadHasMode: Object.prototype.hasOwnProperty.call(args, "writebackMode"),
    payloadMode: args.writebackMode,
    envMode: process.env.topmind_WRITEBACK_MODE,
  });
  if (!modeResolution.ok) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "validation_error",
          kind,
          command,
          validationErrors: [modeResolution.error],
          message: t("error.validationFailedRetry"),
        }, null, 2),
      }],
      isError: true,
    };
  }
  const writebackMode = modeResolution.mode;
  const normalized = normalizeCommandPayload(cmdDef, { ...args, kind, command });
  normalized.writebackMode = writebackMode;
  if (writebackMode === "auto" && cmdDef.supports_dry_run && !payloadHasDryRun) {
    normalized.dryRun = false;
  }

  // Strip review-session internal fields before normalization passes them through.
  delete normalized._reviewed;
  delete normalized._sessionId;

  const validationErrors = validateCommandPayload(cmdDef, normalized);
  if (validationErrors.length > 0) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: "validation_error",
          kind,
          command,
          validationErrors,
          message: t("error.validationFailedRetry"),
        }, null, 2),
      }],
      isError: true,
    };
  }

  // Review check — confirm only; auto writes through (batch mode removed)
  const writesThrough = writebackMode === "auto";
  if (!args._reviewed && !writesThrough) {
    const reviewRequired = checkReviewRequired(cmdDef);
    if (reviewRequired) {
      // Build preview
      const preview = previewTool(registry, kind, command, normalized, pathContext);

      const session = await createReviewSession(kind, command, normalized, reviewRequired, {
        ready: preview.ready,
        missingFields: preview.missingFields,
        invocationPlan: preview.invocationPlan ? {
          command: preview.invocationPlan.command,
          displayCommand: preview.invocationPlan.displayCommand,
        } : null,
      });

      return formatReviewResponse(session);
    }
  }

  // Execute
  const result = await executeTool({
    registry,
    kind,
    command,
    payload: normalized,
    pathContext,
    reviewed: Boolean(args._reviewed) || writesThrough,
    writebackMode,
  });

  return formatToolResult(result);
}

// ── Main loop ─────────────────────────────────────────────────────────────

async function handleRequest(msg) {
  const { id, method, params } = msg;

  try {
    switch (method) {
      case "initialize":
        return sendResponse(id, await handleInitialize(id, params));
      case "tools/list":
        return sendResponse(id, await handleToolsList(id));
      case "tools/call":
        return sendResponse(id, await handleToolsCall(id, params));
      case "notifications/initialized":
        // No response needed for notifications
        return;
      default:
        return sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    return sendError(id, -32603, error.message || String(error));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Accept both topmind_WORKSPACE_ROOT (UTR-native) and topmind_USER_WORKSPACE (Desktop-consistent)
  const userWorkspaceRoot = args.userWorkspaceRoot
    || process.env.topmind_WORKSPACE_ROOT
    || process.env.topmind_USER_WORKSPACE;
  pathContext = await resolveUtrWorkspaceContext(args.userWorkspaceRoot || args.engineRoot || process.cwd(), {
    engineRoot: args.engineRoot || process.env.topmind_ENGINE_ROOT,
    userWorkspaceRoot,
  });

  // Resolve locale from workspace config
  const wsConfig = loadWorkspaceConfig(pathContext.userWorkspaceRoot);
  setLocaleFromConfig(wsConfig);

  // Periodically clean up expired review sessions
  const cleanupTimer = setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (error) {
      sendError(null, -32700, `Parse error: ${error.message}`);
      return;
    }

    try {
      await handleRequest(msg);
    } catch (error) {
      process.stderr.write(t("msg.mcpServerError", { message: error.message }) + "\n");
    }
  });

  rl.on("close", () => {
    clearInterval(cleanupTimer);
    process.stderr.write(t("msg.mcpTransportClosed") + "\n");
  });

  process.stderr.write(t("msg.mcpServerStarted", { version: SERVER_INFO.version }) + "\n");
  process.stderr.write(`[topmind-mcp] engineRoot: ${pathContext.engineRoot}\n`);
  process.stderr.write(`[topmind-mcp] workspaceRoot: ${pathContext.userWorkspaceRoot}\n`);
}

main().catch((error) => {
  process.stderr.write(t("msg.mcpStartFailed", { message: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exit(1);
});
