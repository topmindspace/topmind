# Output language（模型输出语言）

> Skills 正文可以只有一种语言（本 pack 基础版为 zh-CN）。**输出语言 ≠ skill 正文语言。**

两条轨道（解析见 `lib/ai-output-locale.mjs`）：

```text
文档 AI（改写打开的笔记 / Agent 写入正文）
  1. 用户本轮明确要求的语言
  2. 正在处理的原文（选区优先，否则整份材料；忽略代码围栏 / URL）
  3. 工作区 locale（topmind.yaml workspace.locale / locale，再回退中文）
  UI 语言不是这一档。

产品 AI（建议条 · AI 待办 · memory_organize / topic_classify）
  1. 用户本轮明确要求的语言
  2. 当前宿主 UI 语言（Desktop settings.ui.locale，或 Obsidian localeOverride / 应用语言；auto 不算）
  3. 工作区 locale
  Desktop 与 Obsidian 是交替宿主，不叠成一条链。
```

## 不要

- 不要因为本 skill / 系统提示是中文（或英文）就用那种语言写用户正文
- 不要在用户没要求时，把中文笔记改写成英文（或反过来）——文档 AI 不跟 UI
- 不要把 Desktop 与 Obsidian 的 UI 语言叠成一条链

## 要

- 用户说了目标语言 → 两轨道都遵从，即使原文/UI 是另一种语言
- 改写 / 总结 / 续写打开的笔记 → 跟随原文
- 建议条标题/摘要、待办抽取、记忆整理 → 跟随当前宿主 UI（非 auto）
- 没有原文、也没有语言要求（例如空工作区上的「我的情况」模板）→ 跟随工作区 locale
