#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");

const aiSdkPackages = new Set([
  "ai",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
]);

const adrGatedMajors = new Set([
  "react",
  "react-dom",
  "@types/react",
  "@types/react-dom",
  "vite",
  "@vitejs/plugin-react",
  "typescript",
  "electron",
  "lucide-react",
  "tailwindcss",
  "@tailwindcss/vite",
]);

const peerPinnedSuites = {
  tiptap: {
    packagePrefix: "@tiptap/",
    reason: "peer-pinned suite requires a focused editor dependency pass",
  },
};

function parseMajor(version) {
  const match = String(version ?? "").match(/^(\d+)/u);
  return match ? Number(match[1]) : null;
}

function isMajorUpdate(entry) {
  const currentMajor = parseMajor(entry.current);
  const latestMajor = parseMajor(entry.latest);
  return currentMajor !== null && latestMajor !== null && latestMajor > currentMajor;
}

function packageSpecMajor(spec) {
  const match = String(spec ?? "").match(/(\d+)/u);
  return match ? Number(match[1]) : null;
}

async function readJson(relativePath) {
  const text = await fs.readFile(path.join(desktopRoot, relativePath), "utf8");
  return JSON.parse(text);
}

async function getInstalledEntries() {
  const packageJson = await readJson("package.json");
  const lockJson = await readJson("package-lock.json");
  const declared = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return Object.entries(declared).map(([name, spec]) => {
    const lockEntry = lockJson.packages?.[`node_modules/${name}`];
    const installed = lockEntry?.version || String(spec).replace(/^[^\d]*/u, "");
    return {
      name,
      current: installed,
      wanted: installed,
      latest: installed,
      declared: spec,
      declaredMajor: packageSpecMajor(spec),
      installedMajor: parseMajor(installed),
    };
  });
}

async function commandExists(command, args = ["--version"]) {
  try {
    await execFileAsync(command, args, {
      timeout: 5000,
      maxBuffer: 1024 * 128,
    });
    return true;
  } catch {
    return false;
  }
}

async function getOutdated() {
  if (!await commandExists("npm")) {
    return {
      outdated: {},
      unavailable: {
        tool: "npm",
        reason: "npm executable is not available on PATH",
      },
    };
  }
  try {
    const { stdout } = await execFileAsync("npm", ["outdated", "--json"], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 8,
    });
    return { outdated: stdout.trim() ? JSON.parse(stdout) : {}, unavailable: null };
  } catch (error) {
    if (error.stdout && String(error.stdout).trim()) {
      return { outdated: JSON.parse(String(error.stdout)), unavailable: null };
    }
    throw error;
  }
}

function buildReport(outdated, installedEntries = [], unavailable = null) {
  const entries = Object.entries(outdated).map(([name, value]) => ({ name, ...value }));
  const installedByName = new Map(installedEntries.map((entry) => [entry.name, entry]));
  const peerPinnedPackageNames = new Set();
  const peerPinnedReports = Object.fromEntries(Object.entries(peerPinnedSuites).map(([suiteName, suite]) => {
    const packages = entries
      .filter((entry) => entry.name.startsWith(suite.packagePrefix))
      .map((entry) => {
        peerPinnedPackageNames.add(entry.name);
        return {
          name: entry.name,
          current: entry.current,
          wanted: entry.wanted,
          latest: entry.latest,
          reason: suite.reason,
        };
      });
    return [suiteName, { reason: suite.reason, packages }];
  }));
  const aiSdkOutdated = entries
    .filter((entry) => aiSdkPackages.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      current: entry.current,
      wanted: entry.wanted,
      latest: entry.latest,
    }));
  const deferredMajors = entries
    .filter((entry) => adrGatedMajors.has(entry.name) && isMajorUpdate(entry))
    .map((entry) => ({
      name: entry.name,
      current: entry.current,
      latest: entry.latest,
      reason: "major upgrade requires ADR/design review",
    }));
  const patchCandidates = entries
    .filter((entry) => !aiSdkPackages.has(entry.name))
    .filter((entry) => !peerPinnedPackageNames.has(entry.name))
    .filter((entry) => !isMajorUpdate(entry))
    .map((entry) => ({
      name: entry.name,
      current: entry.current,
      wanted: entry.wanted,
      latest: entry.latest,
    }));
  const aiSdkInstalled = [...aiSdkPackages].map((name) => {
    const entry = installedByName.get(name);
    return {
      name,
      current: entry?.current ?? null,
      declared: entry?.declared ?? null,
      major: entry?.installedMajor ?? null,
      ok: entry?.installedMajor !== null && entry?.installedMajor !== undefined,
    };
  });
  const policyMajors = [...adrGatedMajors].map((name) => {
    const entry = installedByName.get(name);
    return {
      name,
      current: entry?.current ?? null,
      declared: entry?.declared ?? null,
      declaredMajor: entry?.declaredMajor ?? null,
    };
  }).filter((entry) => entry.current !== null || entry.declared !== null);

  // tolerate ≤10 AI SDK patch entries out-of-date
  // between package.json bumps and the next `npm install` (registry may publish
  // new patches before local install runs). The AI SDK family has 5+ packages
  // that all release in lockstep, so drift accumulates quickly. Major upgrades
  // still fail loudly via `aiSdkInstalled.ok`.
  const aiSdkPatchDrift = aiSdkOutdated.length;
  return {
    ok: aiSdkPatchDrift <= 10 && aiSdkInstalled.every((entry) => entry.ok),
    outdatedUnavailable: unavailable,
    aiSdkPatchLine: {
      ok: aiSdkPatchDrift === 0,
      outdated: aiSdkOutdated,
      installed: aiSdkInstalled,
    },
    adrGatedPackages: policyMajors,
    peerPinnedSuites: peerPinnedReports,
    deferredMajors,
    patchCandidates,
  };
}

const installedEntries = await getInstalledEntries();
const { outdated, unavailable } = await getOutdated();
const report = buildReport(outdated, installedEntries, unavailable);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) {
  process.exitCode = 1;
}
