// ── zh-CN locale strings ───────────────────────────────────────────────────

export const zhCN = {
  // ── Plugin ──
  plugin_name: "Topmind Stream",
  plugin_description: "Obsidian 的「主区域流式工作台 + 静默 AI 沉淀副驾」",

  // ── Views ──
  stream_workbench_title: "动态工作台",
  sidebar_dock_title: "Topmind",

  // ── Quick Capture ──
  quick_capture_title: "记一下",
  quick_capture_placeholder: "在此输入...",
  quick_capture_submit: "提交",
  quick_capture_target: "目标",
  quick_capture_target_stream: "本周动态",
  quick_capture_target_inbox: "收件箱",
  quick_capture_hint_enter: "⏎ 提交",
  quick_capture_hint_shift_enter: "⇧⏎ 换行",

  // ── Stream Workbench ──
  stream_this_week: "本周动态",
  stream_switch_period: "切换周期",
  stream_empty: "还没有动态，记一下试试 ⚡",
  stream_organize: "整理",

  // ── Suggestions ──
  suggestions_title: "AI 建议",
  suggestions_empty: "暂无建议",
  suggestions_confirm: "确认",
  suggestions_dismiss: "忽略",
  suggestion_topic: "建议专题",
  suggestion_todo: "待办提取",
  suggestion_memory: "写入「我的情况」",
  suggestion_summary: "周期摘要",

  // ── Sidebar Dock ──
  sidebar_today_todos: "今日待办",
  sidebar_recent_stream: "最近动态",
  sidebar_open_workbench: "打开主工作台",
  sidebar_no_todos: "暂无待办",
  sidebar_no_stream: "暂无动态",

  // ── Commands ──
  cmd_quick_capture: "Topmind: 记一下",
  cmd_open_workbench: "Topmind: 打开动态工作台",
  cmd_open_sidebar: "Topmind: 打开侧边栏",
  cmd_organize_period: "Topmind: 整理本周",
  cmd_refresh_suggestions: "Topmind: 刷新 AI 建议",
  cmd_maintain_todos: "Topmind: AI 整理待办",

  // ── Settings ──
  settings_workspace: "工作区与契约",
  settings_stream: "工作台",
  settings_ai: "AI 副驾与写回策略",
  settings_security: "安全与归档",

  settings_auto_open: "启动时自动打开工作台",
  settings_auto_open_desc: "Obsidian 启动时自动打开动态工作台页签",
  settings_timeline_order: "时间轴排序",
  settings_timeline_order_desc: "最新在前 或 最早在前",
  settings_auto_tag: "自动标签解析",
  settings_auto_tag_desc: "支持 #标签 自动提取",

  settings_ai_provider: "AI 服务商",
  settings_ai_provider_desc: "选择 AI 服务商（不配置也能使用基础功能）",
  settings_ai_key: "API Key",
  settings_ai_key_desc: "AI 服务商的 API 密钥",
  settings_ai_base_url: "API Base URL",
  settings_ai_base_url_desc: "OpenAI-compatible API 端点",
  settings_ai_model: "模型",
  settings_ai_model_desc: "使用的模型名称",
  settings_writeback_mode: "写回模式",
  settings_writeback_mode_desc: "「自动保存」或「保存前问我」",
  settings_auto_suggest: "自动准备 AI 建议",
  settings_auto_suggest_desc: "工作区就绪后扫描并生成建议卡片",
  settings_auto_maintain_todos: "自动整理待办",
  settings_auto_maintain_todos_desc: "自动从动态提取待办（默认关，省 Token）",

  settings_backup_keep: "备份保留份数",
  settings_backup_keep_desc: "AI 写入时创建备份的保留份数（0 = 禁用）",
  settings_receipt_keep: "回执保留份数",
  settings_receipt_keep_desc: "写操作回执的保留份数（超出自动清理旧版）",

  // ── Writeback notices ──
  notice_write_pending: "写入待确认 — 请在审阅中确认",
  notice_written: "已记录",
  notice_write_failed: "记录失败",
  notice_executed: "已执行",
  notice_execute_failed: "执行失败",
  notice_organizing: "整理中...",
  notice_organize_done: "整理完成 ✓",
  notice_workspace_not_ready: "当前 Vault 不是 topmind 工作区（缺少 topmind.yaml）",

  // ── Accessibility ──
  stream_expand_entry: "点击展开/收起动态条目",

  // ── URL detection ──
  notice_url_to_inbox: "检测到链接，已路由到收件箱",
  compose_url_hint: "检测到链接，建议使用快速捕获抓取正文到收件箱",

  // ── General ──
  loading: "加载中...",
  error: "出错了",
  saved: "已保存",
  init_workspace: "初始化工作区",
  init_workspace_desc: "在当前 Vault 中创建 topmind 工作区结构",
  init_workspace_success: "工作区已初始化",
  init_workspace_failed: "初始化失败",

  // ── Writeback modes (白话) ──
  writeback_auto: "自动保存",
  writeback_confirm: "保存前问我",

  // ── Workspace modes ──
  // (removed workspaceMode — Kernel auto-detects)

  // ── Timeline order labels ──
  timeline_desc: "↓ 最新在前",
  timeline_asc: "↑ 最早在前",

  // ── AI providers ──
  provider_none: "不使用 AI",
  provider_openai: "OpenAI",
  provider_deepseek: "DeepSeek",
  provider_anthropic: "Anthropic",
  provider_ollama: "Ollama (本地)",
  provider_custom: "自定义 (OpenAI-compatible)",

  // ── AI connection test ──
  settings_ai_test: "测试连接",
  settings_ai_testing: "测试中...",
  settings_ai_test_success: "连接成功 ✓",
  settings_ai_test_failed: "连接失败",
  settings_ai_test_no_key: "请先填入 API Key",

  // ── Security note ──
  settings_security_note: "API Key 存储在 Obsidian 插件 data.json 中（明文）。请勿在共享 Vault 中使用。",
};
