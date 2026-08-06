import test from "node:test";
import assert from "node:assert/strict";
import {
  compareSemver,
  versionFromTag,
  isProductTag,
  desktopVersionFromAssets,
  desktopVersionFromRelease,
  skillsVersionFromAssets,
  extensionVersionFromAssets,
  assetMatcher,
  pickAssets,
  pickLatestReleaseFor,
  checkForDesktopUpdate,
  checkAllSurfaces,
  classifyUpdateError,
  resolveFetchImpl,
  fetchPublicLatestJson,
} from "../electron/lib/update-check.mjs";

test("compareSemver orders dotted versions", () => {
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("1.0.1", "1.0.0"), 1);
  assert.equal(compareSemver("0.9.9", "1.0.0"), -1);
  assert.equal(compareSemver("v1.2.0", "1.1.0"), 1);
});

test("versionFromTag only accepts desktop-v* (not product v*)", () => {
  assert.equal(versionFromTag("desktop-v1.0.1"), "1.0.1");
  assert.equal(versionFromTag("v1.0.0"), null, "product tags are not Desktop versions");
  assert.equal(versionFromTag("skills-v1.0.0"), null);
  assert.equal(versionFromTag("extension-v1.0.0"), null);
  assert.equal(versionFromTag(""), null);
  assert.equal(isProductTag("v1.0.0"), true);
  assert.equal(isProductTag("desktop-v1.0.0"), false);
});

test("desktopVersionFromAssets reads topmind-X.Y.Z installers", () => {
  const assets = [
    { name: "topmind-skills-1.0.0.zip" },
    { name: "topmind-1.0.1-win-x64.exe" },
    { name: "topmind-1.0.0-mac-arm64.dmg" },
  ];
  assert.equal(desktopVersionFromAssets(assets), "1.0.1");
  assert.equal(skillsVersionFromAssets(assets), "1.0.0");
  assert.equal(
    extensionVersionFromAssets([{ name: "topmind-clip-extension-1.0.0.zip" }]),
    "1.0.0",
  );
});

test("desktopVersionFromRelease prefers assets over product tag", () => {
  const rel = {
    tag_name: "v1.0.0",
    assets: [{ name: "topmind-1.0.1-mac-arm64.dmg" }],
  };
  assert.equal(desktopVersionFromRelease(rel), "1.0.1");
  assert.equal(
    desktopVersionFromRelease({ tag_name: "desktop-v1.0.0", assets: [] }),
    "1.0.0",
  );
});

test("assetMatcher picks platform installers", () => {
  const win = assetMatcher("win32", "x64");
  assert.equal(win("topmind-1.0.0-win-x64.exe"), true);
  assert.equal(win("topmind-1.0.0-mac-arm64.dmg"), false);

  const mac = assetMatcher("darwin", "arm64");
  assert.equal(mac("topmind-1.0.0-mac-arm64.dmg"), true);
  assert.equal(mac("topmind-1.0.0-win-x64.exe"), false);

  const linux = assetMatcher("linux", "x64");
  assert.equal(linux("topmind-1.0.0-linux-x64.AppImage"), true);
  assert.equal(linux("topmind-skills-1.0.0.zip"), false);
});

test("pickAssets filters release assets for host", () => {
  const release = {
    assets: [
      { name: "topmind-1.0.0-win-x64.exe", size: 10, browser_download_url: "https://example/win.exe", content_type: "application/octet-stream" },
      { name: "topmind-skills-1.0.0.zip", size: 1, browser_download_url: "https://example/s.zip", content_type: "application/zip" },
      { name: "topmind-1.0.0-mac-arm64.dmg", size: 11, browser_download_url: "https://example/mac.dmg", content_type: "application/x-apple-diskimage" },
    ],
  };
  const win = pickAssets(release, "win32", "x64");
  assert.equal(win.length, 1);
  assert.equal(win[0].name, "topmind-1.0.0-win-x64.exe");
});

test("checkForDesktopUpdate uses asset version not product tag", async () => {
  const payload = [
    {
      draft: false,
      tag_name: "v1.0.0",
      html_url: "https://github.com/topmindspace/topmind/releases/tag/v1.0.0",
      body: "product ship",
      published_at: "2026-07-16T00:00:00Z",
      assets: [
        {
          name: "topmind-1.0.0-mac-arm64.dmg",
          size: 100,
          browser_download_url: "https://example.com/topmind-1.0.0-mac-arm64.dmg",
          content_type: "application/octet-stream",
        },
        {
          name: "topmind-skills-1.0.0.zip",
          size: 50,
          browser_download_url: "https://example.com/skills.zip",
        },
        {
          name: "topmind-clip-extension-1.0.0.zip",
          size: 20,
          browser_download_url: "https://example.com/ext.zip",
        },
      ],
    },
  ];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => payload,
  });

  const result = await checkForDesktopUpdate({
    currentVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    fetchImpl,
    forceApi: true,
    skillsVersion: "1.0.0",
    extensionVersion: "1.0.0",
  });
  assert.equal(result.ok, true);
  assert.equal(result.latestVersion, "1.0.0");
  assert.equal(result.updateAvailable, false);
  assert.equal(result.reason, "up-to-date");

  const multi = await checkAllSurfaces({
    currentVersion: "0.9.0",
    skillsVersion: "0.9.0",
    extensionVersion: "0.9.0",
    platform: "darwin",
    arch: "arm64",
    fetchImpl,
    forceApi: true,
  });
  assert.equal(multi.desktop.updateAvailable, true);
  assert.equal(multi.desktop.latestVersion, "1.0.0");
  assert.equal(multi.skills.updateAvailable, true);
  assert.equal(multi.skills.latestVersion, "1.0.0");
  assert.equal(multi.extension.updateAvailable, true);
  assert.equal(multi.extension.latestVersion, "1.0.0");
});

test("checkForDesktopUpdate reports newer desktop-v release", async () => {
  const payload = [
    {
      draft: false,
      tag_name: "desktop-v1.0.1",
      html_url: "https://github.com/topmindspace/topmind/releases/tag/desktop-v1.0.1",
      body: "notes",
      published_at: "2026-07-16T00:00:00Z",
      assets: [
        {
          name: "topmind-1.0.1-mac-arm64.dmg",
          size: 100,
          browser_download_url: "https://example.com/topmind-1.0.1-mac-arm64.dmg",
          content_type: "application/octet-stream",
        },
      ],
    },
    {
      draft: false,
      tag_name: "skills-v1.0.0",
      html_url: "https://github.com/x/y",
      assets: [],
    },
  ];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => payload,
  });
  const result = await checkForDesktopUpdate({
    currentVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    fetchImpl,
    forceApi: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, "1.0.1");
  assert.equal(result.assets.length, 1);
  assert.equal(result.reason, "newer");
});

test("pickLatestReleaseFor chooses highest surface version", () => {
  const releases = [
    { draft: false, tag_name: "v1.0.0", assets: [{ name: "topmind-1.0.0-win-x64.exe" }] },
    { draft: false, tag_name: "v1.0.1", assets: [{ name: "topmind-1.0.1-win-x64.exe" }] },
  ];
  const pick = pickLatestReleaseFor(releases, desktopVersionFromRelease);
  assert.equal(pick?.version, "1.0.1");
  assert.equal(pick?.release.tag_name, "v1.0.1");
});

test("classifyUpdateError maps network / timeout / 403", () => {
  const net = classifyUpdateError(new Error("fetch failed"));
  assert.equal(net.code, "network");
  assert.match(net.hint, /代理|网络/);
  const to = classifyUpdateError(Object.assign(new Error("aborted"), { name: "AbortError" }));
  assert.equal(to.code, "timeout");
  const rl = classifyUpdateError(new Error("GitHub releases 403: rate"), 403);
  assert.equal(rl.code, "rate-limit");
});

test("resolveFetchImpl returns a function", () => {
  const f = resolveFetchImpl(async () => ({ ok: true }));
  assert.equal(typeof f, "function");
});

test("extension without bundled version is not-bundled", async () => {
  const payload = [
    {
      draft: false,
      tag_name: "v1.0.0",
      html_url: "https://github.com/topmindspace/topmind/releases/tag/v1.0.0",
      assets: [
        { name: "topmind-1.0.0-mac-arm64.dmg", size: 1, browser_download_url: "https://ex/d.dmg" },
        { name: "topmind-skills-1.0.0.zip", size: 1, browser_download_url: "https://ex/s.zip" },
        { name: "topmind-clip-extension-1.0.0.zip", size: 1, browser_download_url: "https://ex/e.zip" },
      ],
    },
  ];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => payload,
  });
  for (const extensionVersion of [null, ""]) {
    const multi = await checkAllSurfaces({
      currentVersion: "1.0.0",
      skillsVersion: "1.0.0",
      extensionVersion,
      platform: "darwin",
      arch: "arm64",
      fetchImpl,
      forceApi: true,
    });
    assert.equal(multi.extension.reason, "not-bundled");
    assert.equal(multi.extension.updateAvailable, false);
    assert.equal(multi.extension.latestVersion, "1.0.0");
    assert.equal(multi.model?.desktopBundlesSkills, true);
    assert.equal(multi.model?.desktopBundlesUtr, true);
  }
});

test("public latest.json path (no GitHub API)", async () => {
  const latest = {
    productTag: "v1.0.3",
    desktop: "1.0.3",
    skills: "1.0.0",
    extension: "1.0.0",
    releaseUrl: "https://github.com/topmindspace/topmind/releases/tag/v1.0.3",
    assets: [
      {
        name: "topmind-1.0.3-mac-arm64.dmg",
        browser_download_url: "https://example.com/topmind-1.0.3-mac-arm64.dmg",
      },
      {
        name: "topmind-skills-1.0.0.zip",
        browser_download_url: "https://example.com/skills.zip",
      },
    ],
  };
  const fetchImpl = async (url) => {
    if (String(url).includes("latest.json")) {
      return { ok: true, json: async () => latest, url: String(url) };
    }
    throw new Error("unexpected url " + url);
  };
  const multi = await checkAllSurfaces({
    currentVersion: "1.0.0",
    skillsVersion: "1.0.0",
    extensionVersion: "1.0.0",
    platform: "darwin",
    arch: "arm64",
    fetchImpl,
  });
  assert.equal(multi.source, "public-latest-json");
  assert.equal(multi.desktop.updateAvailable, true);
  assert.equal(multi.desktop.latestVersion, "1.0.3");
  assert.equal(multi.skills.updateAvailable, false);
});

test("checkAllSurfaces surfaces network errors with actionable message", async () => {
  const fetchImpl = async () => {
    throw new Error("fetch failed");
  };
  // Public-first path (no API): all public fetches fail → Chinese network guidance
  await assert.rejects(
    () =>
      checkAllSurfaces({
        currentVersion: "1.0.0",
        skillsVersion: "1.0.0",
        extensionVersion: "1.0.0",
        fetchImpl,
        retries: 0,
        timeoutMs: 500,
      }),
    /无法获取更新|latest\.json|网络|GitHub/i,
  );
  // Opt-in API path: still actionable
  await assert.rejects(
    () =>
      checkAllSurfaces({
        currentVersion: "1.0.0",
        skillsVersion: "1.0.0",
        extensionVersion: "1.0.0",
        fetchImpl,
        forceApi: true,
        retries: 0,
        timeoutMs: 500,
      }),
    /无法连接 GitHub|网络|代理|fetch failed|无法获取更新/i,
  );
});
