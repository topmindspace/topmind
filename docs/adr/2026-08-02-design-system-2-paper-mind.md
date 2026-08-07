# ADR: Design System 2.0 — 纸感智识工作台（Paper Mind Workbench）

**Date:** 2026-08-02  
**Status:** Superseded（中性色阶由 Design System 2.1 Modern Warm-Neutral 取代，2026-08-07，见 `2026-08-07-desktop-single-entry-dedupe.md` Round 3；品牌墨蓝/teal 身份与 token 架构仍生效）  
**Context:** 旧视觉 "Brand Horizon"（#0a50d0 deep → #1a9ce0 mid → #3de0c8 aqua 双色系 + 冷蓝灰中性）与产品「个人智识工作台 · 长时阅读」定位不完全匹配；且存在散布的硬编码色值（输入框 inset rgba、raw px 字号）。用户批准全新视觉识别，方向「纸感智识工作台」；候选 A 暖纸+墨蓝 / B 冷瓷+黛青 / C 米白+赭石，用户离场后按推荐选定 **A**。

## Decision

1. **色彩身份**：
   - 中性阶：暖纸石色（色相 ~45–55°，低彩度）。Light 纸面 `#f6f4ef`、surface `#fffefb`、chrome `#edeae2`；Dark 暖墨石 `#201e19` 系。
   - 单一强主色：**墨蓝** `--color-brand-deep: #31548e`（dark 抬高至 `#7f9fd4`）。
   - **teal 仅限捕获动作**：`--color-brand-aqua: #2fa89a` / `--color-accent-inbox: #12897b`（dark `#4fc2b0`）——记一下 CTA、inbox 模式、capture skill。
   - 状态色转暖：success `#1a7f53` · warning `#b3760e` · error `#c03d2e` · info = ink mid。
2. **token 纪律**：
   - 所有阴影黑基调 `rgba(10,16,28,…)` → 暖 `rgba(42,36,24,…)`；hairline → `rgba(62,54,38,…)`。
   - 新 token `--shadow-input-inset` 统一输入框凹陷（替代 5 处组件内硬编码 `rgba(12,14,20,0.03)`）。
   - 字号只允许 token 梯（text-5xs 10px 起）；清除全部 `text-[8px]`/raw px。
3. **token 名不变**：`--color-brand-deep/mid/aqua` 等变量名保留（语义结构），仅换值——60KB v4.css 与组件零重命名。
4. **镜像面**：browser-extension `popup.css --mh-*`、`public/favicon.svg` 渐变同步同一色板。

## Consequences

- 样式契约测试断言的具体色值同步更新（uiux-p0/wave2/wave3）。
- PNG/ICO 位图图标（extension icons、build/icon.ico）未重新生成 —— 后续跟进项。
- 备选色板 B/C 未实施；如需切换只改 tokens.css 值层。

## Verification

`npm run desktop:test`（brand-style-contract / uiux-* 契约）+ `desktop:build`；全仓 grep 无 `#0a50d0|#3de0c8|rgba(12,14,20|text-\[8px\]` 残留（docs 历史记录除外）。
