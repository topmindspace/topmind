#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  discoverCategories,
  isValidCategoryName,
  userWorkspaceCategoriesRoot,
  inboxRoot,
  categoryRoot,
  topicRoot,
  topicFilePath,
  globalOutputsRoot,
  buildCliContext,
  validateRequiredRoots,
} from "../core/workspace-context.mjs";
import { parseArgs, resolveMode } from "../core/cli-args.mjs";
import { receiptId } from "../core/receipt.mjs";
import { ensureDir, pathExists, workspaceRelative } from "../core/topic-files.mjs";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  touchUpdatedFrontmatter,
} from "../core/frontmatter.mjs";
import { emitResult } from "../core/result-envelope.mjs";
import { t } from "../core/i18n-strings.mjs";
import {
  resolveStreamTarget,
  shouldAppendToPeriodNote,
  findStreamCategory,
  resolveWorkspaceModel,
  appendToPeriodBody,
  packingLabel,
  executeWrite,
  loadContract,
} from "../../lib/kernel-api.mjs";

// ── CLI helpers ─────────────────────────────────────────────────────────────

async function writeReceipt(receiptDir, name, payload) {
  await ensureDir(receiptDir);
  const target = path.join(receiptDir, `${name}.json`);
  await fs.writeFile(target, JSON.stringify(payload, null, 2), "utf8");
  return target;
}

// ── v3.4 create-topic ───────────────────────────────────────────────────────

async function createTopic({ category, topic, title, mode }, ctx) {
  if (!isValidCategoryName(category)) {
    const engineRoot = ctx.engineRoot || process.cwd();
    const root = userWorkspaceCategoriesRoot(ctx);
    const available = discoverCategories(root, engineRoot).join(", ");
    throw new Error(t("error.invalidCategoryWithAvailable", { category, available: available || t("msg.noTopics") }));
  }
  if (!/^[\p{L}\p{N}._\- \u4e00-\u9fff]+$/u.test(topic)) {
    throw new Error(t("error.topicNameWithSeparator", { topic }));
  }
  const topicDir = topicRoot(ctx, category, topic);
  const topicFile = topicFilePath(ctx, category, topic);
  const existed = await pathExists(topicDir);
  const topicExisted = await pathExists(topicFile);

  // In auto mode, refuse to overwrite an existing topic
  if (mode === "auto" && topicExisted) {
    throw new Error(t("error.topicFileExists", { path: topicFile }));
  }

  const plannedActions = [];
  if (!existed) plannedActions.push({ kind: "mkdir", path: topicDir });

  let createdProject = false;
  let writeEvidence = null;
  if (!(await pathExists(topicFile))) {
    const headingTitle = title || topic;
    const body = `# ${headingTitle}\n\n## Stable Memory\n\n${t("content.placeholderText")}\n\n## Working Notes\n\n${t("content.placeholderText")}\n`;
    plannedActions.push({ kind: "write", path: topicFile });
    if (mode === "auto") {
      await ensureDir(topicDir);
      const fm = { title: headingTitle, category, topic, status: "active" };
      const stamped = touchUpdatedFrontmatter(
        stringifyFrontmatter({ data: fm, body }),
      );
      const contract = loadContract(ctx.userWorkspaceRoot);
      writeEvidence = executeWrite({
        targetPath: topicFile,
        content: stamped,
        workspaceRoot: ctx.userWorkspaceRoot,
        contract,
        operation: "create",
        actor: "user",
        confirmed: true,
        skipShadow: true,
        frontmatter: fm,
      });
      createdProject = true;
    }
  }

  let receipt = null;
  if (mode === "auto") {
    receipt = await writeReceipt(
      path.join(ctx.archiveRootPath, "receipts"),
      receiptId("create-topic"),
      {
        command: "create-topic",
        category,
        topic,
        title: title || topic,
        createdProject,
        timestamp: new Date().toISOString(),
      },
    );
  }

  const topicFileRel = workspaceRelative(topicFile, ctx.userWorkspaceRoot);
  return {
    command: "create-topic",
    mode,
    category,
    topic,
    createdProject,
    existed,
    paths: {
      topicRoot: workspaceRelative(topicDir, ctx.userWorkspaceRoot),
      topicFile: topicFileRel,
    },
    plannedActions,
    receipt,
    wroteFiles: mode === "auto" && (writeEvidence?.wroteFiles !== false || createdProject),
    writebackEvidence: writeEvidence,
    target_path: topicFileRel,
    affected_files: writeEvidence?.affectedFiles || (createdProject ? [topicFileRel] : []),
  };
}

// ── v3.4 capture-note ───────────────────────────────────────────────────────

function classifyRouting({ category, topic }) {
  if (category && topic) return { kind: "topic-note" };
  if (category && !topic) return { kind: "loose-note" };
  return { kind: "inbox" };
}

function safeFileStem(input) {
  return String(input).trim().replace(/\s+/gu, "-").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/gu, "").slice(0, 60) || "untitled";
}

async function captureNote(
  {
    routing,
    title,
    content,
    sourceType,
    source,
    topic: softTopic,
    captureId,
    routeConfidence,
    routeReason,
    mode,
    forceAtom,
  },
  ctx,
) {
  if (!title) throw new Error(t("error.titleRequired"));
  if (!content) throw new Error(t("error.contentRequired"));
  let category = routing?.category;
  const topic = routing?.topic;

  const stamp = new Date().toISOString();
  const engineRoot = ctx.engineRoot || process.cwd();

  // Default loose-stream capture → current period note (weekly/daily/monthly)
  // Topic notes and explicit forceAtom stay one-file-per-capture.
  if (!topic && !forceAtom) {
    const model = resolveWorkspaceModel({
      workspaceRoot: ctx.userWorkspaceRoot,
      engineRoot,
    });
    let catDesc = null;
    if (category && isValidCategoryName(category)) {
      catDesc = model.categories.find((c) => c.directory === category) || null;
    } else if (!category) {
      catDesc = findStreamCategory(model);
      if (catDesc) category = catDesc.directory;
    }

    const streamTarget = resolveStreamTarget({
      workspaceRoot: ctx.userWorkspaceRoot,
      engineRoot,
    });
    if (
      catDesc &&
      shouldAppendToPeriodNote(catDesc, streamTarget.packing) &&
      streamTarget.periodAbsPath
    ) {
      const targetFile = streamTarget.periodAbsPath;
      const targetDir = path.dirname(targetFile);
      let existing = "";
      let existed = false;
      if (await pathExists(targetFile)) {
        existed = true;
        existing = await fs.readFile(targetFile, "utf8");
      }
      const parsed = existed ? parseFrontmatter(existing) : { data: {}, body: "" };
      const body = appendToPeriodBody(parsed.body || "", {
        content,
        title,
        packing: streamTarget.packing,
        appendHeading: streamTarget.appendHeading,
      });
      const frontmatter = {
        ...parsed.data,
        title: streamTarget.title || parsed.data?.title || title,
        category: category || streamTarget.streamCategory?.directory || null,
        topic: null,
        type: "stream-period",
        stream_packing: streamTarget.packing,
        source_type: sourceType || parsed.data?.source_type || "user-original",
        updated_at: stamp,
        captured_at: parsed.data?.captured_at || stamp,
        capture_id: captureId || parsed.data?.capture_id || null,
      };
      const md = touchUpdatedFrontmatter(
        stringifyFrontmatter({ data: frontmatter, body }),
        stamp,
      );

      let writeEvidence = null;
      if (mode === "auto") {
        await ensureDir(targetDir);
        const contract = loadContract(ctx.userWorkspaceRoot);
        writeEvidence = executeWrite({
          targetPath: targetFile,
          content: md,
          workspaceRoot: ctx.userWorkspaceRoot,
          contract,
          operation: existed ? "update" : "create",
          actor: "user",
          confirmed: true,
          skipShadow: true,
          role: "loose-stream",
          frontmatter,
        });
      }

      const rel = workspaceRelative(targetFile, ctx.userWorkspaceRoot);
      return {
        command: "capture-note",
        mode,
        routing: { category: category || null, topic: null },
        title,
        targetFile: rel,
        relativeLocation: streamTarget.periodRelPath || rel,
        created: mode === "auto",
        appended: true,
        streamPacking: streamTarget.packing,
        streamLabel: packingLabel(streamTarget.packing),
        userMessage: t("msg.writtenToStream", { packing: packingLabel(streamTarget.packing), file: path.basename(targetFile) }),
        frontmatter,
        wroteFiles: mode === "auto" && writeEvidence?.wroteFiles !== false,
        sourceType: sourceType || "user-original",
        topic: softTopic || null,
        path: rel,
        periodNote: true,
        existed,
        writebackEvidence: writeEvidence,
        target_path: rel,
        affected_files: writeEvidence?.affectedFiles || (mode === "auto" ? [rel] : []),
      };
    }
  }

  let targetDir;
  let relativeLocation;

  if (category && topic) {
    if (!isValidCategoryName(category)) throw new Error(t("error.invalidCategory", { category }));
    if (!/^[\p{L}\p{N}._\- \u4e00-\u9fff]+$/u.test(topic)) throw new Error(t("error.invalidTopicName", { topic }));
    targetDir = topicRoot(ctx, category, topic);
    relativeLocation = `${category}/${topic}`;
  } else if (category) {
    if (!isValidCategoryName(category)) throw new Error(t("error.invalidCategory", { category }));
    targetDir = categoryRoot(ctx, category);
    relativeLocation = `${category}`;
  } else {
    targetDir = inboxRoot(ctx);
    relativeLocation = path.basename(targetDir);
  }

  const stem = safeFileStem(title);
  const fileName = `${stamp.slice(0, 10)}-${stem}.md`;
  const targetFile = path.join(targetDir, fileName);

  const frontmatter = {
    title,
    category: category || null,
    topic: topic || null,
    soft_topic: softTopic || null,
    source_type: sourceType || "user-original",
    source: source || null,
    captured_at: stamp,
    capture_id: captureId || null,
    route_confidence: routeConfidence || null,
    route_reason: routeReason || null,
  };

  const md = stringifyFrontmatter({ data: frontmatter, body: `\n# ${title}\n\n${content}\n` });

  let writeEvidence = null;
  if (mode === "auto") {
    await ensureDir(targetDir);
    const contract = loadContract(ctx.userWorkspaceRoot);
    writeEvidence = executeWrite({
      targetPath: targetFile,
      content: md,
      workspaceRoot: ctx.userWorkspaceRoot,
      contract,
      operation: "create",
      actor: "user",
      confirmed: true,
      skipShadow: true,
      frontmatter,
    });
  }

  const rel = workspaceRelative(targetFile, ctx.userWorkspaceRoot);
  return {
    command: "capture-note",
    mode,
    routing: { category: category || null, topic: topic || null },
    title,
    targetFile: rel,
    relativeLocation,
    created: mode === "auto",
    appended: false,
    periodNote: false,
    frontmatter,
    wroteFiles: mode === "auto" && writeEvidence?.wroteFiles !== false,
    sourceType: sourceType || "user-original",
    topic: topic || softTopic || null,
    path: rel,
    writebackEvidence: writeEvidence,
    target_path: rel,
    affected_files: writeEvidence?.affectedFiles || (mode === "auto" ? [rel] : []),
  };
}

// ── v3.4 save-output ────────────────────────────────────────────────────────

async function saveOutput({ category, topic, title, content, sourceType, ifExists, mode }, ctx) {
  if (!category || !topic) throw new Error(t("error.saveOutputParams"));
  if (!title || !content) throw new Error(t("error.saveOutputContent"));
  // v3.4: all deliverables go to flat 88 Outputs/, not topic-level outputs/
  const outputsRoot = globalOutputsRoot(ctx);
  const stem = safeFileStem(title);
  let targetFile = path.join(outputsRoot, `${stamp()}-${stem}.md`);

  if (ifExists === "fail" && await pathExists(targetFile)) {
    throw new Error(t("error.outputExists", { path: targetFile }));
  }

  const frontmatter = {
    title,
    category,
    topic,
    source_type: sourceType || "ai-derived",
    generated_at: stamp(true),
  };
  const md = stringifyFrontmatter({ data: frontmatter, body: `\n# ${title}\n\n${content}\n` });

  let writeEvidence = null;
  if (mode === "auto") {
    await ensureDir(outputsRoot);
    const contract = loadContract(ctx.userWorkspaceRoot);
    writeEvidence = executeWrite({
      targetPath: targetFile,
      content: md,
      workspaceRoot: ctx.userWorkspaceRoot,
      contract,
      operation: "create",
      actor: "user",
      confirmed: true,
      skipShadow: true,
      role: "delivery",
      frontmatter,
    });
  }

  const rel = workspaceRelative(targetFile, ctx.userWorkspaceRoot);
  return {
    command: "save-output",
    mode,
    category,
    topic,
    title,
    targetFile: rel,
    ifExists: ifExists || "create-new",
    created: mode === "auto",
    wroteFiles: mode === "auto" && writeEvidence?.wroteFiles !== false,
    writebackEvidence: writeEvidence,
    target_path: rel,
    affected_files: writeEvidence?.affectedFiles || (mode === "auto" ? [rel] : []),
  };
}

function stamp(iso = false) {
  const d = new Date();
  if (iso) return d.toISOString();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ── v3.2 update-topic ───────────────────────────────────────────────────────

async function updateTopic({ category, topic, content, replaceReason, mode }, ctx) {
  if (!category || !topic) throw new Error(t("error.updateTopicParams"));
  if (!content) throw new Error(t("error.updateTopicContent"));
  if (!replaceReason) throw new Error(t("error.updateTopicReason"));
  const topicFile = topicFilePath(ctx, category, topic);

  let snapshot = null;
  if (mode === "auto" && await pathExists(topicFile)) {
    snapshot = await writeReceipt(
      path.join(ctx.archiveRootPath, "backups", category, topic),
      receiptId("update-topic"),
      {
        command: "update-topic",
        category,
        topic,
        replaceReason,
        originalContent: await fs.readFile(topicFile, "utf8"),
        timestamp: new Date().toISOString(),
      },
    );
  }

  let writeEvidence = null;
  if (mode === "auto") {
    await ensureDir(path.dirname(topicFile));
    const fm = { category, topic, status: "active", last_replace_reason: replaceReason };
    const stamped = touchUpdatedFrontmatter(
      stringifyFrontmatter({ data: fm, body: `\n${content}\n` }),
    );
    const contract = loadContract(ctx.userWorkspaceRoot);
    writeEvidence = executeWrite({
      targetPath: topicFile,
      content: stamped,
      workspaceRoot: ctx.userWorkspaceRoot,
      contract,
      operation: "update",
      actor: "user",
      confirmed: true,
      skipShadow: true,
      frontmatter: fm,
    });
  }

  const rel = workspaceRelative(topicFile, ctx.userWorkspaceRoot);
  return {
    command: "update-topic",
    mode,
    category,
    topic,
    replaceReason,
    topicFile: rel,
    snapshot,
    created: mode === "auto",
    wroteFiles: mode === "auto" && writeEvidence?.wroteFiles !== false,
    writebackEvidence: writeEvidence,
    target_path: rel,
    affected_files: writeEvidence?.affectedFiles || (mode === "auto" ? [rel] : []),
  };
}

// ── dispatcher ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const roots = validateRequiredRoots(args);
  const ctx = buildCliContext(roots);
  const mode = resolveMode(args);

  let data;
  switch (args.command) {
    case "create-topic":
      data = await createTopic({ category: args.category, topic: args.topic, title: args.title, mode }, ctx);
      break;
    case "capture-note":
      data = await captureNote({
        routing: { category: args.category, topic: args.routingTopic },
        title: args.title,
        content: args.content,
        sourceType: args.sourceType,
        source: args.source,
        topic: args.softTopic,
        captureId: args.captureId,
        routeConfidence: args.routeConfidence,
        routeReason: args.routeReason,
        mode,
        forceAtom: args.forceAtom === true || args.forceAtom === "true" || args.atom === true,
      }, ctx);
      break;
    case "save-output":
      data = await saveOutput({ category: args.category, topic: args.topic, title: args.title, content: args.content, sourceType: args.sourceType, ifExists: args.ifExists, mode }, ctx);
      break;
    case "update-topic":
      data = await updateTopic({ category: args.category, topic: args.topic, content: args.content, replaceReason: args.replaceReason, mode }, ctx);
      break;
    default:
      throw new Error(t("error.unknownCommand", { command: args.command || "(empty)" }));
  }

  emitResult(data, args.format);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});