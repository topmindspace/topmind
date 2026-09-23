/**
 * 公众号质检子集 — AI 味词表 + 段长 / lint 规则。
 *
 * 规则与 `skills/topmind-wechat/scripts/{scan_ai_flavor,lint-wechat}.py` 同源：
 * 完整语义以 Python 真源为准，这里只保留 Desktop 预览 / 质检面板所需子集。
 * 改词表时请对照 skill 脚本，避免两套规则漂移。
 */

export type AiFlavorSeverity = "high" | "mid" | "low";

export interface AiFlavorHit {
  code: string;
  name: string;
  /** i18n key under wechat namespace (e.g. aiNames.A1). UI resolves via t(). */
  nameKey: string;
  pattern: string;
  penalty: number;
  severity: AiFlavorSeverity;
  excerpt: string;
  index: number;
}

export interface LintIssue {
  level: "error" | "warn" | "info";
  rule: string;
  /** zh fallback (skill-sourced wording). UI prefers messageKey. */
  message: string;
  messageKey: string;
  messageParams?: Record<string, string | number>;
  line?: number;
  excerpt?: string;
}

export interface WechatQualityReport {
  aiScore: number;
  aiHits: AiFlavorHit[];
  /** 结构扣分（scan_ai_flavor.structural）：破折号/感叹/无数字/无「我」/emoji/重复段首标签。 */
  structuralDeduction: number;
  lintIssues: LintIssue[];
  charCount: number;
  boldRatio: number;
  paragraphCount: number;
  imageCount: number;
  charsPerImage: number | null;
}

/** AI 味模式（子集：scan_ai_flavor.py HEAD/BODY/TAIL + lint-wechat.py AI_TONE）。 */
const AI_PATTERNS: ReadonlyArray<{
  code: string;
  name: string;
  regex: RegExp;
  penalty: number;
  severity: AiFlavorSeverity;
  weighted?: "head" | "tail";
}> = [
  { code: "A1", name: "开头套话", regex: /在当今(社会|时代)/g, penalty: 8, severity: "high", weighted: "head" },
  { code: "A1", name: "开头套话", regex: /随着[^，。]{2,30}的(发展|日益|不断)/g, penalty: 8, severity: "high", weighted: "head" },
  { code: "A1", name: "开头套话", regex: /众所周知[，,]/g, penalty: 7, severity: "high", weighted: "head" },
  { code: "A1", name: "开头套话", regex: /毋庸置疑[，,]|不可否认[，,]/g, penalty: 7, severity: "high", weighted: "head" },
  { code: "A10", name: "模板口水", regex: /大家好[，,]/g, penalty: 6, severity: "high", weighted: "head" },
  { code: "A10", name: "模板口水", regex: /本文将从[^，。]{0,30}个方面/g, penalty: 7, severity: "high", weighted: "head" },
  { code: "A2", name: "转折连接", regex: /综上所述[，,]|总而言之[，,]/g, penalty: 4, severity: "mid" },
  { code: "A2", name: "转折连接", regex: /此外[，,]|与此同时[，,]|不仅如此[，,]/g, penalty: 2, severity: "low" },
  { code: "A3", name: "官腔形容词", regex: /至关重要|举足轻重|不可或缺/g, penalty: 5, severity: "high" },
  { code: "A3", name: "官腔形容词", regex: /深入(探讨|分析|研究)|高度重视|凝聚共识/g, penalty: 5, severity: "high" },
  { code: "A6", name: "营销黑话", regex: /赋能|抓手|打法|底层逻辑|组合拳|护城河|闭环|赛道|倒逼|复盘|卡位/g, penalty: 5, severity: "high" },
  { code: "A6", name: "营销黑话", regex: /一站式|全链路|破圈|引爆|加持/g, penalty: 4, severity: "mid" },
  { code: "A6", name: "工程圈行话", regex: /踩坑|避坑|干货/g, penalty: 3, severity: "low" },
  { code: "A7", name: "模糊归因", regex: /专家指出|业内人士表示|据相关(研究|调查|数据)表明|大量数据表明/g, penalty: 5, severity: "high" },
  { code: "A8", name: "伪深度", regex: /(是|为)[^，。]{2,15}的(体现|证明|象征)|彰显了[^，。]{2,20}(意义|价值|精神)/g, penalty: 5, severity: "high" },
  { code: "A4", name: "结尾升华", regex: /让我们(共同|一起)|未来可期|任重道远|砥砺前行|扬帆远航|谱写[^，。]{2,15}新篇章/g, penalty: 6, severity: "high", weighted: "tail" },
  { code: "A10", name: "模板口水", regex: /感谢(您的)?(观看|阅读|支持)|以上就是[^，。]{2,30}(全部)?内容|欢迎(指正|交流|留言)/g, penalty: 5, severity: "high" },
  { code: "A12", name: "八股过渡", regex: /不难看出|显而易见|值得注意|值得一提|换句话说|换言之|由此可见|本质上|事实上|意味着/g, penalty: 3, severity: "mid" },
];

/** lint 默认阈值 — 与 lint-wechat.py --max-para / --max-item 默认值一致。 */
export const WECHAT_MAX_PARA = 110;
export const WECHAT_MAX_ITEM = 70;
/** 目标 AI 味分（scan_ai_flavor ≥ 85 为文字关通过线）。 */
export const WECHAT_AI_TARGET = 85;

const CJK_RE = /[\u4e00-\u9fff]/g;
const MD_LINK_RE = /!?\[([^\]]*)\]\([^)\s]*\)/g;
const BARE_URL_RE = /https?:\/\/[^\s)\]|>]+/g;
const BOLD_RE = /\*\*([^*]+)\*\*/g;
const FENCE_RE = /^```(\w*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const CONTAINER_RE = /^:::+\s*(\w+)?/;
const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)/g;
const BOLD_PUNCHLINE_RE = /[。！？]\s*\*\*[^ \n*]{10,120}\*\*[。！？]?\s*$/;

/** 读者视觉长度：URL 不算字数，拉丁字按 0.6 权（lint-wechat.visual_len）。 */
export function visualLen(text: string): number {
  let plain = text.replace(MD_LINK_RE, "$1").replace(BARE_URL_RE, "");
  plain = plain.replace(/[*_`>#|]/g, "");
  const cjk = (plain.match(CJK_RE) || []).length;
  const latin = plain.length - cjk;
  return Math.round(cjk + latin * 0.6);
}

/** 纯中文字数 — frontmatter word_count 口径 \[一-鿿\]。 */
export function countChineseChars(text: string): number {
  return (text.match(CJK_RE) || []).length;
}

function stripFrontmatter(raw: string): { body: string; offset: number } {
  const lines = raw.split("\n");
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        return { body: lines.slice(i + 1).join("\n"), offset: i + 1 };
      }
    }
  }
  return { body: raw, offset: 0 };
}

/**
 * 结构扣分 — 与 scan_ai_flavor.py 的 structural 维度对齐。
 * 注意：Python 侧 structural 累加为负后取 abs；这里直接累加正惩罚，避免符号陷阱。
 */
function structuralDeduction(body: string): number {
  const lines = body.split("\n");
  if (lines.length < 5) return 0;
  let structural = 0;
  const total = body.length;
  const dashes = (body.match(/——/g) || []).length;
  if (dashes >= Math.max(3, Math.floor(total / 200))) structural += 5;
  if (body.includes("！！！") || (body.match(/!!/g) || []).length >= 3) structural += 3;
  if (!/\d/.test(body)) structural += 12;
  if (!/[我我们]/.test(body)) structural += 8;
  const emoji = (body.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  if (emoji >= 3) structural += Math.min(9, (emoji - 2) * 3);
  // 重复段首加粗标签：**结论**：… 同一标签 ≥3 次
  const leadRe = /^\s*\*\*([^*\n]{1,10})\*\*\s*[：:]/gm;
  const labelCount: Record<string, number> = {};
  let lm: RegExpExecArray | null;
  while ((lm = leadRe.exec(body)) !== null) {
    labelCount[lm[1]] = (labelCount[lm[1]] || 0) + 1;
  }
  let repeatedHits = 0;
  for (const k of Object.keys(labelCount)) {
    if (labelCount[k] >= 3) repeatedHits += labelCount[k];
  }
  if (repeatedHits) structural += Math.min(12, repeatedHits * 2);
  return structural;
}

/** AI 味扫描 — 词面 + 结构（scan_ai_flavor 子集；结构见 structuralDeduction）。 */
export function scanAiFlavor(markdown: string): {
  score: number;
  hits: AiFlavorHit[];
  structuralDeduction: number;
} {
  const { body } = stripFrontmatter(markdown);
  const hits: AiFlavorHit[] = [];
  let deducted = 0;
  const headLimit = 200;
  const tailStart = Math.max(0, body.length - 200);

  for (const p of AI_PATTERNS) {
    const re = new RegExp(p.regex.source, p.regex.flags.includes("g") ? p.regex.flags : `${p.regex.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      let penalty = p.penalty;
      if (p.weighted === "head" && m.index <= headLimit) penalty = Math.round(penalty * 1.5);
      if (p.weighted === "tail" && m.index >= tailStart) penalty = Math.round(penalty * 1.5);
      deducted += penalty;
      hits.push({
        code: p.code,
        name: p.name,
        nameKey: `aiNames.${p.code}`,
        pattern: m[0],
        penalty,
        severity: p.severity,
        excerpt: body.slice(Math.max(0, m.index - 12), m.index + m[0].length + 12).replace(/\n/g, " "),
        index: m.index,
      });
      if (hits.length >= 40) break;
    }
    if (hits.length >= 40) break;
  }

  // 段末加粗金句（lint 与 scan 交叉；计词面惩罚）
  const paras = body.split(/\n\s*\n/);
  for (const para of paras) {
    if (/[。！？]\s*\*\*[^ \n*]{10,120}\*\*[。！？]?\s*$/.test(para.trim())) {
      deducted += 4;
      hits.push({
        code: "B1",
        name: "段末加粗金句",
        nameKey: "aiNames.B1",
        pattern: "段落收尾加粗",
        penalty: 4,
        severity: "mid",
        excerpt: para.trim().slice(-40),
        index: body.indexOf(para),
      });
    }
  }

  const structural = structuralDeduction(body);
  return {
    score: Math.max(0, 100 - deducted - structural),
    hits,
    structuralDeduction: structural,
  };
}

/**
 * 排版体检子集 — 段长 / 列表项 / H1 / 加粗密度 / 段末金句 / 图片。
 * 对应 lint-wechat.py 的 error/warn 通道。
 */
export function lintWechat(markdown: string, opts?: { maxPara?: number; maxItem?: number }): LintIssue[] {
  const maxPara = opts?.maxPara ?? WECHAT_MAX_PARA;
  const maxItem = opts?.maxItem ?? WECHAT_MAX_ITEM;
  const { body, offset } = stripFrontmatter(markdown);
  const lines = body.split("\n");
  const issues: LintIssue[] = [];

  let inFence = false;
  let paraBuf: string[] = [];
  let paraStart = 0;
  let prevLevel = 0;
  let consecutiveHeadings = 0;
  let h1Count = 0;
  let totalChars = 0;
  let strongChars = 0;
  let boldPunch = 0;

  const flushPara = (endLine: number) => {
    if (paraBuf.length === 0) return;
    const text = paraBuf.join("");
    const length = visualLen(text);
    totalChars += length;
    const bolds = [...text.matchAll(BOLD_RE)];
    for (const b of bolds) strongChars += (b[1] || "").length;
    if (BOLD_PUNCHLINE_RE.test(text.trim())) boldPunch += 1;

    if (length > maxPara * 1.8) {
      issues.push({
        level: "error",
        rule: "para-too-long",
        message: `段落过长（${length} 字）`,
        messageKey: "lintRules.paraTooLong",
        messageParams: { n: length },
        line: paraStart + offset,
        excerpt: text.slice(0, 40),
      });
    } else if (length > maxPara) {
      issues.push({
        level: "warn",
        rule: "para-long",
        message: `段落偏长（${length} 字），建议拆成两段`,
        messageKey: "lintRules.paraLong",
        messageParams: { n: length },
        line: paraStart + offset,
        excerpt: text.slice(0, 40),
      });
    }
    paraBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1 + offset;

    if (FENCE_RE.test(line.trim())) {
      inFence = !inFence;
      flushPara(i);
      continue;
    }
    if (inFence) continue;

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara(i);
      const level = heading[1].length;
      if (level === 1) h1Count += 1;
      if (prevLevel && level > prevLevel + 1) {
        issues.push({
          level: "warn",
          rule: "heading-skip",
          message: `标题跳级 h${prevLevel} → h${level}`,
          messageKey: "lintRules.headingSkip",
          messageParams: { from: prevLevel, to: level },
          line: lineNo,
          excerpt: heading[2]?.slice(0, 30),
        });
      }
      prevLevel = level;
      consecutiveHeadings += 1;
      if (consecutiveHeadings >= 3) {
        issues.push({
          level: "warn",
          rule: "headings-no-body",
          message: `连续 ${consecutiveHeadings} 个标题无正文，建议合并或补过渡段`,
          messageKey: "lintRules.headingsNoBody",
          messageParams: { n: consecutiveHeadings },
          line: lineNo,
        });
      }
      continue;
    }

    if (line.trim() === "" || CONTAINER_RE.test(line)) {
      flushPara(i);
      consecutiveHeadings = 0;
      continue;
    }

    consecutiveHeadings = 0;

    // 列表项（- / * / 1. ）
    const listMatch = /^\s*(?:[-*+]|\d+\.)\s+/.exec(line);
    if (listMatch) {
      flushPara(i);
      let itemText = line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "" && !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[j]) && !HEADING_RE.test(lines[j]) && !FENCE_RE.test(lines[j].trim())) {
        itemText += lines[j];
        j++;
      }
      const itemLen = visualLen(itemText);
      totalChars += itemLen;
      if (itemLen > maxItem) {
        issues.push({
          level: "warn",
          rule: "item-long",
          message: `列表项偏长（${itemLen} 字），建议拆成多项或改成段落`,
          messageKey: "lintRules.itemLong",
          messageParams: { n: itemLen },
          line: lineNo,
          excerpt: itemText.slice(0, 40),
        });
      }
      i = j - 1;
      continue;
    }

    if (paraBuf.length === 0) paraStart = i;
    paraBuf.push(line);
  }
  flushPara(lines.length);

  if (h1Count > 1) {
    issues.push({
      level: "warn",
      rule: "multiple-h1",
      message: `正文有 ${h1Count} 个 H1，公众号标题在后台单独填写，正文应只保留 1 个主标题`,
      messageKey: "lintRules.multipleH1",
      messageParams: { n: h1Count },
    });
  }

  const boldRatio = totalChars > 0 ? strongChars / totalChars : 0;
  if (boldRatio > 0.2) {
    issues.push({
      level: "warn",
      rule: "bold-heavy",
      message: `加粗占比 ${Math.round(boldRatio * 100)}%（建议 < 20%），重点过多会被稀释`,
      messageKey: "lintRules.boldHeavy",
      messageParams: { n: Math.round(boldRatio * 100) },
    });
  }

  if (boldPunch > 0) {
    issues.push({
      level: "warn",
      rule: "bold-punchline",
      message: `段末加粗金句 ${boldPunch} 处，建议降调为普通陈述句`,
      messageKey: "lintRules.boldPunchline",
      messageParams: { n: boldPunch },
    });
  }

  for (const m of markdown.matchAll(IMG_RE)) {
    const src = m[2] || "";
    if (/^(https?:)?\/\//.test(src)) {
      issues.push({
        level: "info",
        rule: "remote-image",
        message: `远程图片 ${src.slice(0, 40)} — 粘贴不保证转存，导出时请附图片上传清单`,
        messageKey: "lintRules.remoteImage",
        messageParams: { src: src.slice(0, 40) },
      });
    } else if (src) {
      issues.push({
        level: "info",
        rule: "local-image",
        message: `本地图片 ${src.slice(0, 40)} — 公众号需上传素材库或嵌入`,
        messageKey: "lintRules.localImage",
        messageParams: { src: src.slice(0, 40) },
      });
    }
  }

  if (/\\\[|\\begin\{/.test(markdown)) {
    issues.push({
      level: "warn",
      line: 1,
      rule: "latex",
      message: "疑似 LaTeX 公式，公众号不支持，需转成图片",
      messageKey: "lintRules.latex",
    });
  }

  return issues;
}

/** 一键质检：AI 味 + lint + 密度指标。 */
export function analyzeWechatQuality(markdown: string, opts?: { maxPara?: number; maxItem?: number }): WechatQualityReport {
  const { body } = stripFrontmatter(markdown);
  const { score, hits, structuralDeduction: structural } = scanAiFlavor(markdown);
  const lintIssues = lintWechat(markdown, opts);
  const plain = body.replace(BOLD_RE, "$1");
  const charCount = countChineseChars(plain);
  let strongChars = 0;
  for (const b of body.matchAll(BOLD_RE)) strongChars += (b[1] || "").length;
  const visual = Math.max(1, visualLen(body));
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith(":::") && !p.startsWith("```"));
  const imageCount = (body.match(IMG_RE) || []).length;

  return {
    aiScore: score,
    aiHits: hits,
    structuralDeduction: structural,
    lintIssues,
    charCount,
    imageCount,
    charsPerImage: imageCount > 0 ? Math.round(charCount / imageCount) : null,
    boldRatio: strongChars / visual,
    paragraphCount: paragraphs.length,
  };
}

/** 事实勾选清单默认项（本地 state，人工核对；不自动写盘）。 */
export function defaultFactChecklist(): Array<{ id: string; label: string }> {
  return [
    { id: "numbers", label: "承重数字已回一手来源" },
    { id: "sources", label: "外部改稿已核数再改文" },
    { id: "caliber", label: "多口径数据已拆开标注" },
    { id: "logic", label: "反方证据已考虑，结构前后一致" },
    { id: "human", label: "报告腔四症状已人工复查（满分≠有人味）" },
  ];
}
