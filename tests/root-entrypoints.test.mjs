import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

/** Required root scripts — assert presence + value, not full map equality (avoids brittle CI). */
const REQUIRED_SCRIPTS = {
  "docs:guard": "node scripts/check-redesign-contract.mjs",
  "secrets:scan": "node scripts/check-secrets.mjs",
  versions: "node scripts/print-versions.mjs",
  "skills:test": "node --test skills/tests/*.test.mjs integrations/opencode/tests/*.test.mjs",
  "skills:pack": "node scripts/build-pack.mjs",
  "skills:install": "node scripts/install-skills.mjs add",
  "skills:update": "node scripts/install-skills.mjs update",
  "skills:list": "node scripts/install-skills.mjs list",
  "extension:pack": "node scripts/pack-extension.mjs",
  "utr:test": "node --test utr/tests/unit/*.test.mjs utr/tests/integration/*.test.mjs",
  "utr:doctor": "node utr/bin/topmind-cli.mjs doctor --json --mcp",
  "utr:doctor:engine": "node scripts/utr-doctor-engine.mjs",
  "utr:list": "node utr/bin/topmind-cli.mjs tool list",
  "root:test": "node --test tests/*.test.mjs",
  "desktop:dev": "cd topmind-desktop && npm run dev",
  "desktop:typecheck": "cd topmind-desktop && npm run typecheck",
  "desktop:check": "cd topmind-desktop && npm run check:electron",
  "desktop:test": "cd topmind-desktop && npm test",
  "desktop:build": "cd topmind-desktop && npm run build && npm run build:report",
  "desktop:validate": "cd topmind-desktop && npm run validate",
  "desktop:quality": "cd topmind-desktop && npm run check:quality",
  "desktop:pack:prepare": "cd topmind-desktop && npm run pack:prepare",
  "desktop:pack:verify": "cd topmind-desktop && npm run pack:verify",
  "desktop:pack:dir": "cd topmind-desktop && npm run pack:dir",
  "desktop:pack:mac": "cd topmind-desktop && npm run pack:mac",
  "desktop:pack:linux": "cd topmind-desktop && npm run pack:linux",
  "desktop:pack:linux:arm64": "cd topmind-desktop && npm run pack:linux:arm64",
  "desktop:pack:win": "cd topmind-desktop && npm run pack:win",
  "desktop:pack:mac:ci": "cd topmind-desktop && npm run pack:mac:ci",
  "desktop:pack:linux:ci": "cd topmind-desktop && npm run pack:linux:ci",
  "desktop:pack:win:ci": "cd topmind-desktop && npm run pack:win:ci",
  "obsidian:dev": "cd obsidian-plugin && npm run dev",
  "obsidian:build": "cd obsidian-plugin && npm run build",
  "obsidian:typecheck": "cd obsidian-plugin && npm run typecheck",
  "obsidian:test": "cd obsidian-plugin && npm test",
  "obsidian:validate": "cd obsidian-plugin && npm run typecheck && npm run build && npm test && npm run pack:verify",
  "obsidian:pack": "cd obsidian-plugin && npm run build && npm run pack",
  test: "npm run root:test && npm run skills:test && npm run utr:test && npm run desktop:test && npm run obsidian:test",
  validate:
    "npm run secrets:scan && npm run docs:guard && npm run root:test && npm run skills:test && npm run utr:test && npm run utr:doctor:engine && npm run desktop:validate && npm run obsidian:validate",
  pack: "npm run pack:all",
  "pack:skills": "npm run skills:pack",
  "pack:extension": "npm run extension:pack",
  "pack:all": "npm run skills:pack && npm run extension:pack && npm run obsidian:pack",
};

test("root package exposes stable daily scripts for skills, UTR, Desktop, extension packs", () => {
  const packageJson = readJson("package.json");

  assert.equal(packageJson.private, true);
  assert.deepEqual(Object.keys(packageJson.dependencies ?? {}), ["yaml"]);
  assert.deepEqual(Object.keys(packageJson.devDependencies ?? {}), []);

  const scripts = packageJson.scripts ?? {};
  for (const [name, value] of Object.entries(REQUIRED_SCRIPTS)) {
    assert.equal(scripts[name], value, `script ${name} must match`);
  }

  // Forbidden / retired surfaces
  assert.equal(scripts["tui:test"], undefined, "must not have tui:test script");
  assert.doesNotMatch(packageJson.description, /TUI/u, "package description should not mention TUI");
});

test("root docs guard script is the canonical redesign contract check", () => {
  const guardScript = readText("scripts/check-redesign-contract.mjs");

  assert.match(guardScript, /const WORKFLOW_TEXT = "收进来 -> 继续做 -> 交付\/沉淀 -> 找回\/调整"/);
  assert.match(
    guardScript,
    /const EXTENSION_FLOW_TEXT = "Source Connector -> Object Adapter -> Action Registry -> Tool Contract -> Surface Placement"/,
  );
  assert.match(guardScript, /current UTR command count/);
  assert.match(guardScript, /foregroundJargonSurfaces/);
  assert.match(guardScript, /搜索项目、章节、资料、自动化/);
  assert.match(guardScript, /应用到 AI 自动化和手动操作/);
  assert.match(guardScript, /自动化审阅/);
  assert.match(guardScript, /自动化操作/);
  assert.match(guardScript, /自动化能力/);
});

test("version truth sources exist; docs only point at them (no multi-copy version tables)", async () => {
  const { VERSION_TRUTH, readAllVersions } = await import("../scripts/print-versions.mjs");
  const rows = readAllVersions();
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.match(row.version, /^\d+\.\d+\.\d+/u, `${row.source} must be semver-like`);
    assert.ok(fs.existsSync(path.join(repoRoot, row.source)), row.source);
  }

  // Entry docs must name each truth path so agents know where to bump — not paste numbers.
  const pathSurfaces = [
    "README.md",
    "README.en.md",
    "AGENTS.md",
    "PRODUCT-BOUNDARIES.md",
    "docs/README.md",
  ];
  for (const rel of pathSurfaces) {
    const text = readText(rel);
    for (const t of VERSION_TRUTH) {
      assert.ok(
        text.includes(t.source) || text.includes(t.source.replace(/^\//u, "")),
        `${rel} must link/name truth source ${t.source}`,
      );
    }
    // Ban bold “current version” columns that force every bump to touch all docs
    assert.doesNotMatch(
      text,
      /\|\s*\*\*\d+\.\d+\.\d+\*\*\s*\|/u,
      `${rel} must not hardcode **x.y.z** version cells — use npm run versions / truth files`,
    );
  }

  // print-versions is the human/CI printer
  const printer = readText("scripts/print-versions.mjs");
  assert.match(printer, /VERSION_TRUTH/);
  assert.match(readJson("package.json").scripts.versions, /print-versions/);
});

test("entry docs describe root scripts and do not keep known stale commands", () => {
  const rootReadme = readText("README.md");
  const tools = readText("TOOLS.md");
  const agEnts = readText("AGENTS.md");
  const utrReadme = readText("utr/README.md");

  let desktopReadme = "";
  let frontendArchitecture = "";
  try {
    desktopReadme = readText("topmind-desktop/README.md");
  } catch {
    /* optional */
  }
  try {
    frontendArchitecture = readText("topmind-desktop/FRONTEND-ARCHITECTURE.md");
  } catch {
    /* optional */
  }

  for (const scriptName of [
    "npm run validate",
    "npm run utr:doctor",
    "npm run utr:list",
    "npm run desktop:dev",
    "npm run skills:test",
  ]) {
    assert.match(rootReadme, new RegExp(scriptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(tools, /Roots|Commands/);
  assert.match(agEnts, /Root scripts from repo root/);
  assert.match(utrReadme, /8 域|8 域 28 命令|28 registry|28 命令/);
  assert.match(rootReadme, /查看当前 UTR 动作域和命令/);
  assert.match(utrReadme, /可选 agent 底座|动作底座|确定性.*命令|optional/iu);
  assert.match(utrReadme, /PRODUCT-BOUNDARIES|不依赖 Desktop|optional/iu);
  assert.match(utrReadme, /操作执行审阅|审阅/);
  assert.match(utrReadme, /操作结果审查|affectedFiles|回执/);
  assert.match(utrReadme, /操作命令|commands/iu);
  assert.doesNotMatch(rootReadme, /查看当前 UTR 工具域和命令/);
  assert.doesNotMatch(utrReadme, /当前目标是 project-first 工具底座|工具执行审阅|工具结果审查|未知工具命令/u);
  assert.doesNotMatch(utrReadme, /18 个 tools/);
  if (desktopReadme) {
    assert.doesNotMatch(desktopReadme, /docs\/README\.md/);
  }
  if (frontendArchitecture) {
    assert.doesNotMatch(frontendArchitecture, /npx tsx --test/);
    assert.match(frontendArchitecture, /tsx --test/);
  }
  assert.doesNotMatch(rootReadme, /memory-archive/);
});
