/**
 * Lightweight i18n for UTR tools — no external dependencies.
 *
 * Resolves locale from: explicit param → topmind_LOCALE env → "zh-CN" default.
 * Falls back to "en-US" for any unrecognized locale.
 *
 * Usage:
 *   import { t, setLocale } from "./i18n-strings.mjs";
 *   setLocale("zh-CN");
 *   throw new Error(t("error.invalidCategory", { category }));
 *
 * Locale can also be resolved from workspace config:
 *   import { setLocaleFromConfig } from "./i18n-strings.mjs";
 *   setLocaleFromConfig(config);
 */

const STRINGS = {
  "en-US": {
    // ── Tool errors ──────────────────────────────────────────────────
    "error.invalidCategory": "Invalid category: {{category}}",
    "error.invalidCategoryWithAvailable": "Invalid category: {{category}}. Available: {{available}}",
    "error.invalidTopicName": "Invalid topic name: {{topic}}",
    "error.topicNotFound": "Topic not found: {{category}}/{{topic}}",
    "error.missingParam": "Missing required parameter: --{{key}}",
    "error.unknownFileScope": "Unknown file scope: {{scope}}",
    "error.topicDirNotFound": "Topic directory not found: {{path}}",
    "error.topicDirMissing": "Topic directory does not exist",
    "error.topicFileOptional": "topic.md not found (optional for topics)",
    "error.titleRequired": "Missing required parameter: --title",
    "error.contentRequired": "Missing required parameter: --content",
    "error.unknownCommand": "Unknown command: {{command}}",
    "error.stateParseError": "Optional state.json corrupted: {{message}}",
    "error.topicNameWithSeparator": "Invalid topic name: {{topic}}. Topic name cannot contain path separators.",
    "error.topicFileExists": "Topic file already exists, refusing to overwrite: {{path}}",
    "error.receiptPathRequired": "Missing required parameter: --receipt-path",
    "error.receiptPathNotFound": "Receipt path does not exist: {{path}}",
    "error.outputExists": "Output with same name already exists: {{path}}",
    "error.topicFileNotExist": "Topic file does not exist: {{path}}. Create the topic first.",
    "error.saveOutputParams": "save-output requires --category and --topic",
    "error.saveOutputContent": "save-output requires --title and --content",
    "error.appendTopicParams": "append-topic requires --slug and --content",
    "error.updateTopicParams": "update-topic requires --category and --topic",
    "error.updateTopicContent": "update-topic requires --content",
    "error.updateTopicReason": "update-topic requires --replace-reason",
    "error.appendProfileParams": "append-profile requires --section and --content",
    "error.coreMemoryPath": "Cannot resolve core memory path: ensure a stream/loose-stream category exists, or configure memory.dir",
    "error.safetyPathFailed": "Cannot generate safety path for same-name file: {{path}}",
    "error.invalidIfExists": "Invalid ifExists value: \"{{value}}\", allowed: {{allowed}}",
    "error.sourcePathRequired": "Missing required parameter: --source-path",
    "error.sourcePathNotFound": "Source file not found: {{path}}",
    "error.slugRequired": "Missing required parameter: --slug",
    "error.sectionRequired": "Missing required parameter: --section",
    "error.periodRequired": "Missing required parameter: --period",
    "error.mappingJsonParse": "mapping JSON parse failed: {{message}}",
    // ── Executor errors ──────────────────────────────────────────────
    "error.unknownOperation": "Unknown operation: {{kind}}.{{command}}",
    "error.validationFailed": "Parameter validation failed:\n{{errors}}",
    "error.missingScript": "Contract {{kind}} missing execution.script",
    // ── Core messages ────────────────────────────────────────────────
    "msg.noTopics": "(none)",
    "msg.checkingCategory": "Checking {{category}}",
    "msg.writtenToStream": "Written to {{packing}} ({{file}})",
    "msg.coreMemoryUpdated": "Updated core memory · {{section}}",
    "msg.migrateV4NoProjectsRoot": "No v2.x projects/ root found; workspace is already v3.4+ or non-standard.",
    "msg.migrateV4NameNotMatched": "Name does not match v2.x rules and no explicit mapping provided",
    // ── Contract registry errors ─────────────────────────────────────
    "error.missingField": "Missing required field: {{key}}",
    "error.unsupportedSchema": "Unsupported schema_version: {{version}}",
    "error.invalidSkill": "Invalid skill: {{skill}}, allowed: {{allowed}}",
    "error.invalidRuntime": "Invalid execution.runtime: {{runtime}}, allowed: {{allowed}}",
    "error.missingRuntime": "execution.runtime missing",
    "error.missingScriptField": "execution.script missing",
    "error.deprecatedFallback": "execution.fallback is deprecated: UTR only allows contracts pointing to deterministic CLI tools",
    "error.missingCmdField": "commands.{{name}}.{{field}} missing",
    "error.invalidCmdGroup": "commands.{{name}}.group invalid: {{value}}, allowed: {{allowed}}",
    "error.invalidCmdRisk": "commands.{{name}}.risk_level invalid: {{value}}",
    "error.invalidCmdPolicy": "commands.{{name}}.review_policy invalid: {{value}}",
    "error.commandsMissing": "commands missing or malformed",
    "error.contractsDirFailed": "Failed to read contracts directory: {{dir}}: {{message}}",
    "error.jsonParseFailed": "JSON parse failed: {{message}}",
    "error.duplicateKind": "Duplicate tool kind: {{kind}}",
    "error.duplicateCommand": "Duplicate command: {{key}}",
    "error.contractsLoadFailed": "Failed to load contracts:\n{{errors}}",
    "error.unknownTool": "Unknown tool: {{kind}}",
    "error.unknownCommandInRegistry": "Unknown command: {{key}}",
    // ── Review policy labels ─────────────────────────────────────────
    "review.auto": "Auto-execute",
    "review.preview_or_auto": "Preview first",
    "review.confirm": "Explicit confirm",
    // ── Workspace context errors ─────────────────────────────────────
    "error.missingEngineSubdirs": "Workspace {{path}} missing engine subdirectories: {{subdirs}}",
    "error.unresolvableWorkspacePath": "No resolvable workspace path provided",
    "error.engineRootNotFound": "Could not locate topmind engine root from {{path}}",
    "error.unresolvableDataWorkspacePath": "No resolvable data workspace path provided",
    "error.dataWorkspaceNotFound": "Could not locate topmind data workspace",
    "error.unsupportedWorkspaceRoot": "Unsupported workspace root: {{root}}/",
    "error.missingRequiredFlag": "Missing required parameter: --{{flag}}",
    // ── Path resolver ────────────────────────────────────────────────
    "error.commandNotFoundInContract": "Command {{command}} not found in contract {{kind}}",
    // ── MCP server ───────────────────────────────────────────────────
    "error.reviewSessionExpired": "Review session expired or not found. Please re-invoke the tool call.",
    "error.invalidToolName": "Invalid tool name: {{name}}. Format should be kind.command",
    "error.unknownOperationName": "Unknown operation: {{name}}",
    "error.validationFailedRetry": "Parameter validation failed. Please fix and retry.",
    "msg.mcpServerError": "[topmind-mcp] Error: {{message}}",
    "msg.mcpTransportClosed": "[topmind-mcp] Transport closed.",
    "msg.mcpServerStarted": "[topmind-mcp] topmind MCP Server v{{version}} started",
    "msg.mcpStartFailed": "[topmind-mcp] Startup failed: {{message}}",
    // ── Tool mapper ──────────────────────────────────────────────────
    "msg.dryRunOmitted": "; when omitted, follows save settings: auto-save with receipt, or enters review.",
    "msg.placeholderExample": " (e.g.: {{placeholder}})",
    // ── Review session ───────────────────────────────────────────────
    "msg.reviewRequired": "Tool {{kind}}.{{command}} requires manual review. After review, re-invoke with _reviewed: true and _sessionId: \"{{sessionId}}\" to execute.",
    // ── Doctor ───────────────────────────────────────────────────────
    "error.pathMissing": "{{label}} does not exist: {{path}}",
    "error.scriptMissing": "{{kind}} entry script does not exist: {{script}}",
    "error.runtimeUnavailable": "Runtime unavailable: {{runtime}}",
    "error.mcpToolCountMismatch": "MCP tools/list count {{actual}} differs from expected surface {{expected}} (registry has {{total}} commands).",
    "error.workspaceDoctorFailed": "Failed to execute workspace doctor.",
    // ── Workspace audit ──────────────────────────────────────────────
    "error.missingRootDir": "Missing required root directory: {{label}}",
    "error.v2LegacyProjectsRoot": "Detected v2.x legacy projects/ root: {{name}}/. Use workspace-transform.migrate-v4 to migrate to category roots ({NN-Name}/).",
    "error.v2DeprecatedRoot": "Detected v2.x deprecated global root: {{name}}/. v3.1 no longer supports; migrate to reference category or 99-归档/.",
    "error.reservedSlotActivated": "Detected category directory: {{slot}} {{name}}/. v3.2 categories are dynamically discovered, no reserved slot restrictions.",
    "error.forbiddenSystemFile": "User workspace contains forbidden system junk file .DS_Store.",
    "error.forbiddenTempFile": "User workspace contains forbidden temp file: {{name}}",
    "error.runtimeStateInWorkspace": "User workspace contains runtime state directory/file, must migrate back to engine or local tool directory.",
    "error.v2AnchorDrift": "Topic {{topic}} still contains v2.x default anchor {{file}}; v3.1 removed this rule (should write into topic.md).",
    "error.invalidCategoryDirName": "Top-level directory {{name}}/ does not match category naming {NN-Name}/ or {NN Name}/. Custom categories use two-digit prefix.",
    "error.deprecatedField": "Note frontmatter still uses deprecated field: {{field}}",
    "error.topicPlaceholderDir": "Active topic {{topic}} still retains historical placeholder directory, should migrate or clean up.",
    // ── Contract metadata skill labels ───────────────────────────────
    "skill.workspace-read": "Category & Topic Read",
    "skill.workspace-write": "Category & Topic Write",
    "skill.workspace-transform": "Category & Topic Transform",
    "skill.workspace-maintain": "Category & Topic Maintain",
    "skill.contract": "Contract",
    "skill.memory": "Memory",
    "skill.lifecycle": "Lifecycle",
    "skill.derived": "Derived",
    "skill.unknown": "Unknown engine",
    // ── Contract validator ───────────────────────────────────────────
    "error.missingRequiredParam": "Missing required parameter: {{label}}",
    "error.invalidSelectValue": "{{label}}: invalid value \"{{value}}\", allowed: {{allowed}}",
    "error.mustBeNumber": "{{label}}: must be a number",
    "error.minValue": "{{label}}: minimum value is {{min}}",
    "error.maxValue": "{{label}}: maximum value is {{max}}",
    "error.invalidCategoryPattern": "{{label}}: invalid category name, only letters, numbers, spaces, hyphens, CJK allowed",
    "error.invalidTopicPattern": "{{label}}: invalid topic name, only letters, numbers, spaces, dots, hyphens, underscores, CJK allowed",
    "error.mustBeText": "{{label}}: must be text",
    "error.mustBeConfirmed": "{{label}}: must be explicitly confirmed",
    "error.missingRoutingCategory": "Missing required parameter: category (routing.category)",
    "error.invalidRoutingCategory": "Category (routing.category): invalid category name, only letters, numbers, spaces, hyphens, CJK allowed",
    "error.invalidRoutingTopic": "Topic (routing.topic): invalid topic name, only letters, numbers, spaces, dots, hyphens, underscores, CJK allowed",
    // ── Workspace content templates ──────────────────────────────────
    "content.placeholderText": "(to be filled)",
    "content.coreMemoryTitle": "My Status",
    "content.coreMemoryPreferences": "Preferences",
    "content.coreMemoryGoals": "Current Goals",
    "content.coreMemoryCollaborators": "Key People & Collaboration",
    "content.coreMemoryOngoing": "In Progress",
    "content.sourcePrefix": "(source: {{source}})",
    // ── Workspace read reasons ───────────────────────────────────────
    "msg.backupReason": "Pre-writeback snapshot, can be used for manual recovery of old versions.",
    "msg.trashReason": "Recycle copy before deletion or move, can be used for manual recovery.",
    "msg.archivedTopicReason": "Archived topic directory, can be moved back to its category root.",
    "msg.revisionReason": "Revision copy from lock/finalize, original file not overwritten.",
    // ── CLI ──────────────────────────────────────────────────────────
    "cli.unknownSubcommand": "Unknown subcommand. Usage: topmind-cli doctor or topmind-cli tool <list|inspect|preview|run>",
    "cli.runHelpForUsage": "Run topmind-cli --help for full usage.",
    "cli.unknownAction": "Unknown action: {{action}}. Available: list, inspect, preview, run",
    "cli.missingKind": "Missing tool kind. Usage: topmind-cli tool inspect <kind>",
    "cli.missingKindOrCommand": "Missing kind or command. Usage: topmind-cli tool <preview|run> <kind> <command> --input-json '...'",
    "cli.invalidJson": "--input-json is not valid JSON",
    "cli.error": "Error: {{message}}",
  },
  "zh-CN": {
    // ── Tool errors ──────────────────────────────────────────────────
    "error.invalidCategory": "无效的大类: {{category}}",
    "error.invalidCategoryWithAvailable": "无效的大类: {{category}}。当前可用类别: {{available}}",
    "error.invalidTopicName": "专题名格式错误: {{topic}}",
    "error.topicNotFound": "专题不存在: {{category}}/{{topic}}",
    "error.missingParam": "缺少必需参数: --{{key}}",
    "error.unknownFileScope": "未知文件范围: {{scope}}",
    "error.topicDirNotFound": "专题目录不存在: {{path}}",
    "error.topicDirMissing": "专题目录不存在",
    "error.topicFileOptional": "topic.md 不存在；专题可有可无",
    "error.titleRequired": "缺少必需参数: --title",
    "error.contentRequired": "缺少必需参数: --content",
    "error.unknownCommand": "未知命令: {{command}}",
    "error.stateParseError": "可选 state.json 损坏: {{message}}",
    "error.topicNameWithSeparator": "专题名格式错误: {{topic}}。专题名不能包含路径分隔符。",
    "error.topicFileExists": "专题主页已存在，拒绝覆盖: {{path}}",
    "error.receiptPathRequired": "缺少必需参数: --receipt-path",
    "error.receiptPathNotFound": "记录路径不存在: {{path}}",
    "error.outputExists": "同名输出已存在: {{path}}",
    "error.topicFileNotExist": "专题主页不存在: {{path}}。先创建专题。",
    "error.saveOutputParams": "save-output 需要 --category 和 --topic",
    "error.saveOutputContent": "save-output 需要 --title 和 --content",
    "error.appendTopicParams": "append-topic 需要 --slug 和 --content",
    "error.updateTopicParams": "update-topic 需要 --category 和 --topic",
    "error.updateTopicContent": "update-topic 需要 --content",
    "error.updateTopicReason": "update-topic 需要 --replace-reason",
    "error.appendProfileParams": "append-profile 需要 --section 和 --content",
    "error.coreMemoryPath": "无法解析「我的情况」路径：请先有动态/loose-stream 类，或配置 memory.dir",
    "error.safetyPathFailed": "无法为同名文件生成安全路径: {{path}}",
    "error.invalidIfExists": "无效的 ifExists 值: \"{{value}}\"，允许: {{allowed}}",
    "error.sourcePathRequired": "缺少必需参数: --source-path",
    "error.sourcePathNotFound": "源文件不存在: {{path}}",
    "error.slugRequired": "缺少必需参数: --slug",
    "error.sectionRequired": "缺少必需参数: --section",
    "error.periodRequired": "缺少必需参数: --period",
    "error.mappingJsonParse": "mapping JSON 解析失败: {{message}}",
    // ── Executor errors ──────────────────────────────────────────────
    "error.unknownOperation": "未知操作命令: {{kind}}.{{command}}",
    "error.validationFailed": "参数校验失败:\n{{errors}}",
    "error.missingScript": "契约 {{kind}} 缺少 execution.script",
    // ── Core messages ────────────────────────────────────────────────
    "msg.noTopics": "(无)",
    "msg.checkingCategory": "检查 {{category}}",
    "msg.writtenToStream": "已记到{{packing}}（{{file}}）",
    "msg.coreMemoryUpdated": "已更新「我的情况」· {{section}}",
    "msg.migrateV4NoProjectsRoot": "未发现 v2.x projects/ 根，已是 v3.4+ 工作区或非标准工作区。",
    "msg.migrateV4NameNotMatched": "命名不匹配 v2.x 规则且未提供显式映射",
    // ── Contract registry errors ─────────────────────────────────────
    "error.missingField": "缺少必需字段: {{key}}",
    "error.unsupportedSchema": "不支持的 schema_version: {{version}}",
    "error.invalidSkill": "skill 无效: {{skill}}，允许值: {{allowed}}",
    "error.invalidRuntime": "execution.runtime 无效: {{runtime}}，允许值: {{allowed}}",
    "error.missingRuntime": "execution.runtime 缺失",
    "error.missingScriptField": "execution.script 缺失",
    "error.deprecatedFallback": "execution.fallback 已废弃：UTR 只允许契约指向确定性 CLI 工具",
    "error.missingCmdField": "commands.{{name}}.{{field}} 缺失",
    "error.invalidCmdGroup": "commands.{{name}}.group 无效: {{value}}，允许值: {{allowed}}",
    "error.invalidCmdRisk": "commands.{{name}}.risk_level 无效: {{value}}",
    "error.invalidCmdPolicy": "commands.{{name}}.review_policy 无效: {{value}}",
    "error.commandsMissing": "commands 缺失或格式错误",
    "error.contractsDirFailed": "契约目录读取失败: {{dir}}: {{message}}",
    "error.jsonParseFailed": "JSON 解析失败: {{message}}",
    "error.duplicateKind": "工具 kind 重复: {{kind}}",
    "error.duplicateCommand": "命令重复: {{key}}",
    "error.contractsLoadFailed": "契约加载失败:\n{{errors}}",
    "error.unknownTool": "未知工具: {{kind}}",
    "error.unknownCommandInRegistry": "未知命令: {{key}}",
    // ── Review policy labels ─────────────────────────────────────────
    "review.auto": "自动执行",
    "review.preview_or_auto": "预览优先",
    "review.confirm": "明确确认",
    // ── Workspace context errors ─────────────────────────────────────
    "error.missingEngineSubdirs": "工作区 {{path}} 缺少 engine 子目录：{{subdirs}}",
    "error.unresolvableWorkspacePath": "未提供可解析的工作区路径",
    "error.engineRootNotFound": "未能从 {{path}} 定位 topmind engine root",
    "error.unresolvableDataWorkspacePath": "未提供可解析的数据工作区路径",
    "error.dataWorkspaceNotFound": "未能定位 topmind 数据工作区",
    "error.unsupportedWorkspaceRoot": "不支持的工作区根：{{root}}/",
    "error.missingRequiredFlag": "缺少必需参数: --{{flag}}",
    // ── Path resolver ────────────────────────────────────────────────
    "error.commandNotFoundInContract": "契约 {{kind}} 中未找到命令: {{command}}",
    // ── MCP server ───────────────────────────────────────────────────
    "error.reviewSessionExpired": "审阅会话已过期或不存在。请重新发起工具调用。",
    "error.invalidToolName": "无效工具名: {{name}}。格式应为 kind.command",
    "error.unknownOperationName": "未知操作命令: {{name}}",
    "error.validationFailedRetry": "参数校验失败。请修正参数后重试。",
    "msg.mcpServerError": "[topmind-mcp] 处理错误: {{message}}",
    "msg.mcpTransportClosed": "[topmind-mcp] 传输关闭。",
    "msg.mcpServerStarted": "[topmind-mcp] topmind MCP Server v{{version}} 已启动",
    "msg.mcpStartFailed": "[topmind-mcp] 启动失败: {{message}}",
    // ── Tool mapper ──────────────────────────────────────────────────
    "msg.dryRunOmitted": "；省略时按保存设置处理：自动保存并返回回执，或进入审阅入口。",
    "msg.placeholderExample": " (例: {{placeholder}})",
    // ── Review session ───────────────────────────────────────────────
    "msg.reviewRequired": "工具 {{kind}}.{{command}} 需要人工审阅。请审阅后附带 _reviewed: true 和 _sessionId: \"{{sessionId}}\" 重新调用以执行。",
    // ── Doctor ───────────────────────────────────────────────────────
    "error.pathMissing": "{{label}} 不存在：{{path}}",
    "error.scriptMissing": "{{kind}} 入口脚本不存在：{{script}}",
    "error.runtimeUnavailable": "运行时不可用：{{runtime}}",
    "error.mcpToolCountMismatch": "MCP tools/list 数量 {{actual}} 与期望表面 {{expected}} 不一致（注册表共 {{total}} 命令）。",
    "error.workspaceDoctorFailed": "无法执行 workspace doctor 诊断。",
    // ── Workspace audit ──────────────────────────────────────────────
    "error.missingRootDir": "缺少必要根目录：{{label}}",
    "error.v2LegacyProjectsRoot": "检测到 v2.x 旧 projects/ 根目录：{{name}}/。请用 workspace-transform.migrate-v4 一次性迁移到类别根（{NN-Name}/）。",
    "error.v2DeprecatedRoot": "检测到 v2.x 弃用的全局根：{{name}}/。v3.1 不再支持；迁移资料到 60 参考资料/ 大类或 99-归档/。",
    "error.reservedSlotActivated": "检测到类别目录：{{slot}} {{name}}/。v3.2 类别动态自发现，无预留槽位限制。",
    "error.forbiddenSystemFile": "用户工作区包含禁止提交的系统垃圾文件 .DS_Store。",
    "error.forbiddenTempFile": "用户工作区包含禁止存在的临时文件：{{name}}",
    "error.runtimeStateInWorkspace": "用户工作区包含运行时状态目录/文件，必须迁回 engine 或本地工具目录。",
    "error.v2AnchorDrift": "专题 {{topic}} 仍含 v2.x 默认锚点 {{file}}；v3.1 已删除此规约（应写进 topic.md）。",
    "error.invalidCategoryDirName": "顶级目录 {{name}}/ 不符合大类命名 {NN-名称}/ 或 {NN 名称}/。自定义类别请使用两位编号前缀。",
    "error.deprecatedField": "note frontmatter 仍使用已废弃字段：{{field}}",
    "error.topicPlaceholderDir": "active 专题 {{topic}} 下仍保留历史占位目录，应该迁出或清理。",
    // ── Contract metadata skill labels ───────────────────────────────
    "skill.workspace-read": "大类与专题读取",
    "skill.workspace-write": "大类与专题写入",
    "skill.workspace-transform": "大类与专题转换",
    "skill.workspace-maintain": "大类与专题维护",
    "skill.contract": "契约",
    "skill.memory": "记忆",
    "skill.lifecycle": "生命周期",
    "skill.derived": "衍生",
    "skill.unknown": "未知引擎",
    // ── Contract validator ───────────────────────────────────────────
    "error.missingRequiredParam": "缺少必需参数: {{label}}",
    "error.invalidSelectValue": "{{label}}: 无效值 \"{{value}}\"，允许: {{allowed}}",
    "error.mustBeNumber": "{{label}}: 必须是数字",
    "error.minValue": "{{label}}: 最小值为 {{min}}",
    "error.maxValue": "{{label}}: 最大值为 {{max}}",
    "error.invalidCategoryPattern": "{{label}}: 无效的大类名，只允许文字、数字、空格、连字符、中文",
    "error.invalidTopicPattern": "{{label}}: 无效的专题名，只允许文字、数字、空格、点、横线、下划线、中文",
    "error.mustBeText": "{{label}}: 必须是文本",
    "error.mustBeConfirmed": "{{label}}: 必须明确确认",
    "error.missingRoutingCategory": "缺少必需参数: 大类（routing.category）",
    "error.invalidRoutingCategory": "大类（routing.category）: 无效的大类名，只允许文字、数字、空格、连字符、中文",
    "error.invalidRoutingTopic": "专题（routing.topic）: 无效的专题名，只允许文字、数字、空格、点、横线、下划线、中文",
    // ── Workspace content templates ──────────────────────────────────
    "content.placeholderText": "(待补充)",
    "content.coreMemoryTitle": "我的情况",
    "content.coreMemoryPreferences": "偏好",
    "content.coreMemoryGoals": "当前目标",
    "content.coreMemoryCollaborators": "关键的人与协作",
    "content.coreMemoryOngoing": "进行中的事",
    "content.sourcePrefix": "（来源：{{source}}）",
    // ── Workspace read reasons ───────────────────────────────────────
    "msg.backupReason": "写回前快照，可用于人工恢复旧版本。",
    "msg.trashReason": "删除或移动前的回收副本，可用于人工恢复。",
    "msg.archivedTopicReason": "归档专题目录，可从归档区移回对应大类根。",
    "msg.revisionReason": "锁定或定稿文件产生的修订副本，原文件未被覆盖。",
    // ── CLI ──────────────────────────────────────────────────────────
    "cli.unknownSubcommand": "未知子命令。使用: topmind-cli doctor 或 topmind-cli tool <list|inspect|preview|run>",
    "cli.runHelpForUsage": "运行 topmind-cli --help 查看完整用法。",
    "cli.unknownAction": "未知操作: {{action}}。可用: list, inspect, preview, run",
    "cli.missingKind": "缺少工具 kind。用法: topmind-cli tool inspect <kind>",
    "cli.missingKindOrCommand": "缺少 kind 或 command。用法: topmind-cli tool <preview|run> <kind> <command> --input-json '...'",
    "cli.invalidJson": "--input-json 不是有效的 JSON",
    "cli.error": "错误: {{message}}",
  },
};

const SUPPORTED = Object.keys(STRINGS);
let _locale = null;

/**
 * Resolve locale from param, env, or default.
 * @param {string} [explicit]
 * @returns {string}
 */
export function resolveLocale(explicit) {
  if (explicit && SUPPORTED.includes(explicit)) return explicit;
  const env = typeof process !== "undefined" ? process.env?.topmind_LOCALE : null;
  if (env && SUPPORTED.includes(env)) return env;
  return "zh-CN";
}

/**
 * Set the active locale for subsequent t() calls.
 * @param {string} locale
 */
export function setLocale(locale) {
  _locale = resolveLocale(locale);
}

/**
 * Set locale from workspace config (looks for `locale` field).
 * Falls back to env / default if not found.
 * @param {object} [config] — normalized workspace config
 */
export function setLocaleFromConfig(config) {
  if (config?.locale && SUPPORTED.includes(config.locale)) {
    _locale = config.locale;
  } else {
    _locale = resolveLocale();
  }
}

/**
 * Get the current active locale.
 * @returns {string}
 */
export function getLocale() {
  if (!_locale) _locale = resolveLocale();
  return _locale;
}

/**
 * Translate a key with optional interpolation.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const locale = getLocale();
  const table = STRINGS[locale] || STRINGS["en-US"];
  let s = table[key] || STRINGS["en-US"][key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{{${k}}}`, String(v));
    }
  }
  return s;
}

export { SUPPORTED };
