/**
 * Per-surface latest package, fail-closed download, and replace-in-place.
 * Drives the shipped update-check / companion-download / install functions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assetMatcher,
  checkAllSurfaces,
  desktopVersionFromRelease,
  obsidianVersionFromRelease,
  skillsVersionFromRelease,
} from "../electron/lib/update-check.mjs";
import {
  downloadCompanionAsset,
  withCompanionDownload,
} from "../electron/lib/companion-download.mjs";
import { decideDesktopInstallerHandoff, unpackArchive } from "../electron/lib/install-swap.mjs";
import { installObsidianPlugin } from "../electron/lib/companion-lifecycle.mjs";
import { installSkillsPackLocal, readSkillsExtraReceipt } from "../electron/lib/skills-extra.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readerFrom(bytes) {
  return {
    getReader() {
      let done = false;
      return {
        async read() {
          if (done) return { done: true, value: undefined };
          done = true;
          return { done: false, value: bytes };
        },
      };
    },
  };
}

const productRelease = {
  draft: false,
  tag_name: "v5",
  html_url: "https://github.com/topmindspace/topmind/releases/tag/v5",
  assets: [
    {
      name: "topmind-5.0.0-win-x64.exe",
      size: 10,
      browser_download_url:
        "https://github.com/topmindspace/topmind/releases/download/v5/topmind-5.0.0-win-x64.exe",
    },
    {
      name: "topmind-5.0.0-win-arm64.exe",
      size: 11,
      browser_download_url:
        "https://github.com/topmindspace/topmind/releases/download/v5/topmind-5.0.0-win-arm64.exe",
    },
  ],
};

const skillsRelease = {
  draft: false,
  tag_name: "v4.14.0",
  html_url: "https://github.com/topmindspace/topmind-skills/releases/tag/v4.14.0",
  assets: [
    {
      name: "topmind-skills-4.14.0.zip",
      size: 20,
      browser_download_url:
        "https://github.com/topmindspace/topmind-skills/releases/download/v4.14.0/topmind-skills-4.14.0.zip",
    },
  ],
};

const obsidianRelease = {
  draft: false,
  tag_name: "4.18.2",
  html_url: "https://github.com/topmindspace/topmind-obsidian/releases/tag/4.18.2",
  assets: ["main.js", "manifest.json", "styles.css"].map((name) => ({
    name,
    size: 3,
    browser_download_url: `https://github.com/topmindspace/topmind-obsidian/releases/download/4.18.2/${name}`,
  })),
};

function releaseFetch(extra = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes("/repos/topmindspace/topmind-skills/")) {
      return { ok: true, status: 200, json: async () => extra.skills || [skillsRelease] };
    }
    if (u.includes("/repos/topmindspace/topmind-obsidian/")) {
      return { ok: true, status: 200, json: async () => extra.obsidian || [obsidianRelease] };
    }
    if (u.includes("/repos/topmindspace/topmind/")) {
      return { ok: true, status: 200, json: async () => extra.product || [productRelease] };
    }
    if (u.includes("latest.json")) {
      return { ok: false, status: 404, statusText: "Not Found", text: async () => "", json: async () => ({}) };
    }
    throw new Error(`unexpected url ${u}`);
  };
}

test("sister repos stay separate: obsidian community files, skills asset, windows arch", async () => {
  assert.equal(
    desktopVersionFromRelease({ tag_name: "v5", repo: "topmindspace/topmind", assets: [] }),
    null,
  );
  assert.equal(
    obsidianVersionFromRelease({ tag_name: "v5", repo: "topmindspace/topmind", assets: [] }),
    null,
  );
  assert.equal(
    obsidianVersionFromRelease({ tag_name: "v4.14.0", repo: "topmindspace/topmind-skills", assets: [] }),
    null,
  );
  assert.equal(
    skillsVersionFromRelease({
      tag_name: "4.18.2",
      repo: "topmindspace/topmind-obsidian",
      assets: obsidianRelease.assets,
    }),
    null,
  );

  const win = assetMatcher("win32", "x64");
  const arm = assetMatcher("win32", "arm64");
  assert.equal(win("topmind-5.0.0-win-x64.exe"), true);
  assert.equal(win("topmind-5.0.0-win-arm64.exe"), false);
  assert.equal(arm("topmind-5.0.0-win-arm64.exe"), true);
  assert.equal(arm("topmind-5.0.0-win-x64.exe"), false);

  const multi = await checkAllSurfaces({
    currentVersion: "1.0.0",
    skillsVersion: "4.0.0",
    extensionVersion: "1.0.0",
    obsidianVersion: "4.0.0",
    platform: "win32",
    arch: "x64",
    fetchImpl: releaseFetch(),
    forceApi: true,
    retries: 0,
  });

  assert.equal(multi.obsidian.latestVersion, "4.18.2");
  assert.equal(multi.obsidian.repo, "topmindspace/topmind-obsidian");
  assert.deepEqual(
    multi.obsidian.assets.map((a) => a.name).sort(),
    ["main.js", "manifest.json", "styles.css"],
  );
  assert.ok(
    multi.obsidian.assets.every((a) => String(a.url).includes("topmindspace/topmind-obsidian/releases/download/4.18.2/")),
  );
  assert.ok(!multi.obsidian.assets.some((a) => String(a.url).includes("topmind-obsidian-4.18.2.zip")));

  assert.equal(multi.skills.latestVersion, "4.14.0");
  assert.equal(multi.skills.assets.length, 1);
  assert.match(multi.skills.assets[0].url, /topmindspace\/topmind-skills\/releases\/download\/v4\.14\.0\/topmind-skills-4\.14\.0\.zip/);
  assert.notEqual(multi.skills.latestVersion, "5");
  assert.notEqual(multi.skills.latestVersion, "5.0.0");

  assert.equal(multi.desktop.assets.length, 1);
  assert.equal(multi.desktop.assets[0].name, "topmind-5.0.0-win-x64.exe");
  assert.ok(!multi.desktop.assets.some((a) => /arm64/.test(a.name)));
});

test("skills release without a zip uses the published tar.gz", async () => {
  const tarOnly = {
    draft: false,
    tag_name: "v4.14.0",
    assets: [
      {
        name: "topmind-skills-4.14.0.tar.gz",
        size: 8,
        browser_download_url:
          "https://github.com/topmindspace/topmind-skills/releases/download/v4.14.0/topmind-skills-4.14.0.tar.gz",
      },
    ],
  };
  const multi = await checkAllSurfaces({
    currentVersion: "1.0.0",
    skillsVersion: "4.0.0",
    extensionVersion: "1.0.0",
    obsidianVersion: "4.18.2",
    platform: "win32",
    arch: "x64",
    fetchImpl: releaseFetch({ skills: [tarOnly] }),
    forceApi: true,
    retries: 0,
  });
  assert.equal(multi.skills.latestVersion, "4.14.0");
  assert.equal(multi.skills.assets[0].name, "topmind-skills-4.14.0.tar.gz");
});

test("a missing platform asset is not found, not up to date", async () => {
  const macOnly = {
    draft: false,
    tag_name: "v1.2.0",
    assets: [
      {
        name: "topmind-1.2.0-mac-arm64.dmg",
        size: 4,
        browser_download_url: "https://github.com/topmindspace/topmind/releases/download/v1.2.0/topmind-1.2.0-mac-arm64.dmg",
      },
    ],
  };
  const multi = await checkAllSurfaces({
    currentVersion: "1.2.0",
    skillsVersion: "4.14.0",
    extensionVersion: "1.0.0",
    obsidianVersion: "4.18.2",
    platform: "win32",
    arch: "x64",
    fetchImpl: releaseFetch({ product: [macOnly] }),
    forceApi: true,
    retries: 0,
  });
  assert.equal(multi.desktop.reason, "asset-not-found");
  assert.notEqual(multi.desktop.reason, "up-to-date");
  assert.equal(multi.desktop.updateAvailable, false);
  assert.equal(multi.desktop.assets.length, 0);
});

test("404 and hash mismatch do not report a successful download", async () => {
  const missingDir = path.join(os.tmpdir(), `topmind-dl-404-${Date.now()}`);
  const missing = await downloadCompanionAsset({
    surface: "skills",
    version: "4.14.0",
    tag: "v4.14.0",
    tempDir: missingDir,
    fetchImpl: async () => ({ ok: false, status: 404, statusText: "Not Found" }),
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.claimedLatest, false);
  assert.equal(existsSync(missingDir), false);

  const badDir = path.join(os.tmpdir(), `topmind-dl-hash-${Date.now()}`);
  const mismatch = await downloadCompanionAsset({
    surface: "skills",
    version: "4.14.0",
    tag: "v4.14.0",
    tempDir: badDir,
    fetchImpl: async (url) => {
      const u = String(url);
      const body = u.includes("SHA256")
        ? Buffer.from("deadbeef  topmind-skills-4.14.0.zip\n")
        : Buffer.from("payload-bytes");
      return { ok: true, status: 200, body: readerFrom(body) };
    },
  });
  assert.equal(mismatch.ok, false);
  assert.match(String(mismatch.error), /hash-mismatch|verification failed/i);
  assert.equal(existsSync(badDir), false);

  const okDir = path.join(os.tmpdir(), `topmind-dl-ok-${Date.now()}`);
  const urls = [];
  const done = await withCompanionDownload(
    {
      surface: "obsidian",
      version: "4.18.2",
      tag: "4.18.2",
      tempDir: okDir,
      assets: obsidianRelease.assets.map((a) => ({ name: a.name, url: a.browser_download_url })),
      fetchImpl: async (url) => {
        urls.push(String(url));
        return { ok: true, status: 200, body: readerFrom(Buffer.from("x")) };
      },
    },
    async () => ({ ok: true }),
  );
  assert.equal(done.ok, true);
  assert.equal(existsSync(okDir), false);
  assert.ok(urls.every((u) => !u.includes("topmind-obsidian-4.18.2.zip")));
  assert.equal(urls.filter((u) => u.endsWith("/main.js") || u.endsWith("/manifest.json") || u.endsWith("/styles.css")).length, 3);
});

test("locked or failed replace leaves the previous plugin and skills receipt", async () => {
  const vault = await mkdtemp(path.join(os.tmpdir(), "tm-vault-"));
  const plugins = path.join(vault, ".obsidian", "plugins");
  const pluginDir = path.join(plugins, "topmind-stream");
  await mkdir(pluginDir, { recursive: true });
  const previous = JSON.stringify({ id: "topmind-stream", version: "1.0.0", name: "old" });
  await writeFile(path.join(pluginDir, "manifest.json"), previous, "utf8");
  await writeFile(path.join(pluginDir, "main.js"), "old", "utf8");

  const source = await mkdtemp(path.join(os.tmpdir(), "tm-plugin-src-"));
  await writeFile(
    path.join(source, "manifest.json"),
    JSON.stringify({ id: "topmind-stream", version: "4.18.2", name: "new" }),
    "utf8",
  );
  await writeFile(path.join(source, "main.js"), "new", "utf8");

  const locked = await installObsidianPlugin({
    pluginsRoot: plugins,
    sourceDir: source,
    probeLock: async () => ({ locked: true, owner: "Obsidian" }),
  });
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "close-app-and-retry");
  assert.equal(locked.kill, false);
  assert.equal(await readFile(path.join(pluginDir, "manifest.json"), "utf8"), previous);

  const failed = await installObsidianPlugin({
    pluginsRoot: plugins,
    sourceDir: source,
    copyImpl: async () => {
      throw new Error("disk full");
    },
  });
  assert.equal(failed.ok, false);
  assert.notEqual(failed.ok, true);
  assert.equal(await readFile(path.join(pluginDir, "manifest.json"), "utf8"), previous);

  const clean = await installObsidianPlugin({
    pluginsRoot: plugins,
    sourceDir: source,
  });
  assert.equal(clean.ok, true);
  assert.equal(clean.version, "4.18.2");
  const installed = JSON.parse(await readFile(path.join(pluginDir, "manifest.json"), "utf8"));
  assert.equal(installed.version, "4.18.2");

  const pack = await mkdtemp(path.join(os.tmpdir(), "tm-skills-pack-"));
  const dest = await mkdtemp(path.join(os.tmpdir(), "tm-skills-dest-"));
  await mkdir(path.join(pack, "s1"), { recursive: true });
  await writeFile(path.join(pack, "s1", "SKILL.md"), "---\nname: s1\ndescription: old\n---\n", "utf8");
  await writeFile(path.join(pack, "topmind-pack.json"), JSON.stringify({ name: "topmind", version: "1.0.0" }), "utf8");
  const first = await installSkillsPackLocal(pack, { dest });
  assert.equal(first.ok, true);
  assert.equal(first.version, "1.0.0");

  await writeFile(path.join(pack, "s1", "SKILL.md"), "---\nname: s1\ndescription: new\n---\n", "utf8");
  await writeFile(path.join(pack, "topmind-pack.json"), JSON.stringify({ name: "topmind", version: "4.14.0" }), "utf8");
  const blocked = await installSkillsPackLocal(pack, {
    dest,
    copyImpl: async () => {
      throw new Error("locked");
    },
  });
  assert.equal(blocked.ok, false);
  const receipt = await readSkillsExtraReceipt(dest);
  assert.equal(receipt.version, "1.0.0");
  assert.match(await readFile(path.join(dest, "s1", "SKILL.md"), "utf8"), /old/);

  const upgraded = await installSkillsPackLocal(pack, { dest });
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.version, "4.14.0");
  const next = await readSkillsExtraReceipt(dest);
  assert.equal(next.version, "4.14.0");
});

test("windows unpack uses PowerShell when unzip is absent", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tm-unpack-"));
  const archive = path.join(dir, "topmind-skills-4.14.0.zip");
  await writeFile(archive, "zip-bytes", "utf8");
  const dest = path.join(dir, "out");
  const calls = [];
  const result = await unpackArchive(archive, dest, {
    platform: "win32",
    unzipOnPath: false,
    spawnImpl: async (cmd) => {
      calls.push(cmd);
      if (cmd === "powershell.exe") {
        await mkdir(dest, { recursive: true });
        await writeFile(path.join(dest, "topmind-pack.json"), JSON.stringify({ version: "4.14.0" }), "utf8");
        return true;
      }
      return false;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, "powershell");
  assert.deepEqual(calls, ["powershell.exe"]);
  assert.ok(!calls.includes("unzip"));
  assert.equal(JSON.parse(await readFile(path.join(dest, "topmind-pack.json"), "utf8")).version, "4.14.0");
});

test("latest.json fallback keeps sister assets when the GitHub API throws", async () => {
  const productStamp = {
    productTag: "v5.0.0",
    desktop: "5.0.0",
    releaseUrl: "https://github.com/topmindspace/topmind/releases/tag/v5.0.0",
    assets: [
      {
        name: "topmind-5.0.0-win-x64.exe",
        browser_download_url:
          "https://github.com/topmindspace/topmind/releases/download/v5.0.0/topmind-5.0.0-win-x64.exe",
      },
      {
        name: "topmind-5.0.0-win-arm64.exe",
        browser_download_url:
          "https://github.com/topmindspace/topmind/releases/download/v5.0.0/topmind-5.0.0-win-arm64.exe",
      },
    ],
  };
  const skillsStamp = {
    skills: "4.14.0",
    version: "4.14.0",
    releaseUrl: "https://github.com/topmindspace/topmind-skills/releases/tag/v4.14.0",
    assets: [
      {
        name: "topmind-skills-4.14.0.zip",
        browser_download_url:
          "https://github.com/topmindspace/topmind-skills/releases/download/v4.14.0/topmind-skills-4.14.0.zip",
      },
    ],
  };
  const obsidianStamp = {
    obsidian: "4.18.2",
    version: "4.18.2",
    releaseUrl: "https://github.com/topmindspace/topmind-obsidian/releases/tag/4.18.2",
    assets: ["main.js", "manifest.json", "styles.css"].map((name) => ({
      name,
      browser_download_url: `https://github.com/topmindspace/topmind-obsidian/releases/download/4.18.2/${name}`,
    })),
  };
  const multi = await checkAllSurfaces({
    currentVersion: "1.0.0",
    skillsVersion: "4.0.0",
    extensionVersion: "1.0.0",
    obsidianVersion: "4.0.0",
    platform: "win32",
    arch: "x64",
    retries: 0,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("api.github.com")) throw new Error("API rate limit");
      if (u.includes("latest.json") && u.includes("topmind-skills")) {
        return { ok: true, status: 200, json: async () => skillsStamp };
      }
      if (u.includes("latest.json") && u.includes("topmind-obsidian")) {
        return { ok: true, status: 200, json: async () => obsidianStamp };
      }
      if (u.includes("latest.json")) {
        return { ok: true, status: 200, json: async () => productStamp };
      }
      throw new Error(`unexpected url ${u}`);
    },
  });

  assert.equal(multi.source, "public-latest-json");
  assert.equal(multi.obsidian.latestVersion, "4.18.2");
  assert.equal(multi.obsidian.repo, "topmindspace/topmind-obsidian");
  assert.notEqual(multi.obsidian.reason, "asset-not-found");
  assert.notEqual(multi.obsidian.tagName, "v5.0.0");
  assert.deepEqual(
    multi.obsidian.assets.map((a) => a.name).sort(),
    ["main.js", "manifest.json", "styles.css"],
  );
  assert.ok(
    multi.obsidian.assets.every((a) =>
      String(a.url).includes("topmindspace/topmind-obsidian/releases/download/4.18.2/"),
    ),
  );
  assert.equal(multi.skills.latestVersion, "4.14.0");
  assert.equal(multi.skills.repo, "topmindspace/topmind-skills");
  assert.notEqual(multi.skills.reason, "asset-not-found");
  assert.notEqual(multi.skills.tagName, "v5.0.0");
  assert.equal(multi.skills.assets.length, 1);
  assert.equal(multi.skills.assets[0].name, "topmind-skills-4.14.0.zip");
  assert.match(
    multi.skills.assets[0].url,
    /topmindspace\/topmind-skills\/releases\/download\/v4\.14\.0\/topmind-skills-4\.14\.0\.zip/,
  );
  assert.equal(multi.desktop.assets[0].name, "topmind-5.0.0-win-x64.exe");
});

test("product API success keeps sister latest.json when the sister API throws", async () => {
  const productStamp = {
    productTag: "v5.0.0",
    desktop: "5.0.0",
    assets: [
      {
        name: "topmind-5.0.0-win-x64.exe",
        browser_download_url:
          "https://github.com/topmindspace/topmind/releases/download/v5.0.0/topmind-5.0.0-win-x64.exe",
      },
    ],
  };
  const skillsStamp = {
    skills: "4.14.0",
    version: "4.14.0",
    assets: [
      {
        name: "topmind-skills-4.14.0.zip",
        browser_download_url:
          "https://github.com/topmindspace/topmind-skills/releases/download/v4.14.0/topmind-skills-4.14.0.zip",
      },
    ],
  };
  const obsidianStamp = {
    obsidian: "4.18.2",
    version: "4.18.2",
    assets: ["main.js", "manifest.json", "styles.css"].map((name) => ({
      name,
      browser_download_url: `https://github.com/topmindspace/topmind-obsidian/releases/download/4.18.2/${name}`,
    })),
  };
  const desktopOnly = {
    draft: false,
    tag_name: "v5.0.0",
    html_url: "https://github.com/topmindspace/topmind/releases/tag/v5.0.0",
    assets: productStamp.assets,
  };
  const multi = await checkAllSurfaces({
    currentVersion: "1.0.0",
    skillsVersion: "4.0.0",
    extensionVersion: "1.0.0",
    obsidianVersion: "4.0.0",
    platform: "win32",
    arch: "x64",
    retries: 0,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("api.github.com") && (u.includes("topmind-skills") || u.includes("topmind-obsidian"))) {
        throw new Error("sister API failed");
      }
      if (u.includes("api.github.com") && u.includes("/repos/topmindspace/topmind/")) {
        return { ok: true, status: 200, json: async () => [desktopOnly] };
      }
      if (u.includes("latest.json") && u.includes("topmind-skills")) {
        return { ok: true, status: 200, json: async () => skillsStamp };
      }
      if (u.includes("latest.json") && u.includes("topmind-obsidian")) {
        return { ok: true, status: 200, json: async () => obsidianStamp };
      }
      if (u.includes("latest.json")) {
        return { ok: true, status: 200, json: async () => productStamp };
      }
      throw new Error(`unexpected url ${u}`);
    },
  });

  assert.equal(multi.source, "api+latest-json");
  assert.equal(multi.skills.latestVersion, "4.14.0");
  assert.equal(multi.skills.repo, "topmindspace/topmind-skills");
  assert.notEqual(multi.skills.reason, "no-release");
  assert.notEqual(multi.skills.reason, "asset-not-found");
  assert.equal(multi.skills.updateAvailable, true);
  assert.equal(multi.skills.assets[0].name, "topmind-skills-4.14.0.zip");
  assert.match(multi.skills.assets[0].url, /topmindspace\/topmind-skills\/releases\/download\/v4\.14\.0\/topmind-skills-4\.14\.0\.zip/);
  assert.equal(multi.obsidian.latestVersion, "4.18.2");
  assert.equal(multi.obsidian.repo, "topmindspace/topmind-obsidian");
  assert.notEqual(multi.obsidian.reason, "no-release");
  assert.notEqual(multi.obsidian.reason, "asset-not-found");
  assert.equal(multi.obsidian.updateAvailable, true);
  assert.deepEqual(multi.obsidian.assets.map((a) => a.name).sort(), ["main.js", "manifest.json", "styles.css"]);
  assert.ok(multi.obsidian.assets.every((a) => String(a.url).includes("topmindspace/topmind-obsidian/releases/download/4.18.2/")));
  assert.equal(multi.desktop.assets[0].name, "topmind-5.0.0-win-x64.exe");
  assert.equal(multi.desktop.repo, "topmindspace/topmind");
});

test("windows tar.gz unpack uses tar and does not treat Expand-Archive as success", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tm-targz-"));
  const src = path.join(dir, "src");
  await mkdir(src, { recursive: true });
  await writeFile(path.join(src, "topmind-pack.json"), JSON.stringify({ version: "4.14.0" }), "utf8");
  const archive = path.join(dir, "topmind-skills-4.14.0.tar.gz");
  const packed = spawnSync("tar", ["-czf", archive, "-C", src, "topmind-pack.json"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const dest = path.join(dir, "out");
  const calls = [];
  const result = await unpackArchive(archive, dest, {
    platform: "win32",
    unzipOnPath: false,
    spawnImpl: (cmd, args) => {
      calls.push(cmd);
      if (cmd === "powershell.exe" || cmd === "unzip") return false;
      if (cmd !== "tar") return false;
      const extracted = spawnSync(cmd, args, { encoding: "utf8" });
      return extracted.status === 0;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, "tar");
  assert.deepEqual(calls, ["tar"]);
  assert.ok(!calls.includes("powershell.exe"));
  assert.equal(JSON.parse(await readFile(path.join(dest, "topmind-pack.json"), "utf8")).version, "4.14.0");
});

test("desktop installer prompts, then quits only this topmind process", () => {
  const prompt = decideDesktopInstallerHandoff({ running: true, confirmed: false });
  assert.equal(prompt.action, "prompt");
  assert.equal(prompt.quitTarget, null);
  assert.equal(prompt.reportUpdate, false);
  assert.equal(prompt.killOthers, false);

  const cancel = decideDesktopInstallerHandoff({ running: true, confirmed: false });
  assert.equal(cancel.action, "prompt");
  assert.equal(cancel.reportUpdate, false);

  const go = decideDesktopInstallerHandoff({ running: true, confirmed: true });
  assert.equal(go.action, "handoff");
  assert.equal(go.quitTarget, "self");
  assert.equal(go.killOthers, false);
  assert.equal(go.reportUpdate, false);

  const nsh = path.join(root, "build", "installer.nsh");
  return readFile(nsh, "utf8").then((text) => {
    assert.match(text, /customCheckAppRunning/);
    assert.match(text, /APP_EXECUTABLE_FILENAME/);
    assert.match(text, /MessageBox/);
    assert.doesNotMatch(text, /taskkill[^\n]*electron/i);
    assert.match(text, /taskkill \/IM "\$\{APP_EXECUTABLE_FILENAME\}"/);
  });
});
