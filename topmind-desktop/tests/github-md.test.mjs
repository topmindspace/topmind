/**
 * GitHub capture path tests (pure; network covered by integration elsewhere).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGithubMarkdownFileUrl,
  classifyCaptureUrl,
  preferGithubRawUrl,
} from "../electron/lib/github-md.mjs";
import { methodLabelKey, classifyCaptureUrlKind, urlKindLabelKey } from "../src/components/overlays/quick-capture-helpers.ts";
import { fetchOps } from "../electron/lib/workspace-fetch-ops.mjs";

test("desktop github-md vendored copy classifies the same as kernel", () => {
  assert.equal(isGithubMarkdownFileUrl("https://github.com/a/b"), true);
  assert.equal(isGithubMarkdownFileUrl("https://github.com/a/b/issues/1"), false);
  assert.equal(classifyCaptureUrl("https://github.com/a/b/blob/main/README.md")?.kind, "github-file");
});

test("preferGithubRawUrl rewrites blob to raw", () => {
  assert.equal(
    preferGithubRawUrl("https://github.com/a/b/blob/main/doc.md"),
    "https://raw.githubusercontent.com/a/b/main/doc.md",
  );
});

test("methodLabelKey maps github methods", () => {
  assert.equal(methodLabelKey("github-raw"), "overlays:capture.methodGithubRaw");
  assert.equal(methodLabelKey("github-readme"), "overlays:capture.methodGithubReadme");
  assert.equal(methodLabelKey("readability"), "overlays:capture.methodReadability");
  assert.equal(methodLabelKey(undefined), "overlays:capture.methodHeuristic");
});

test("classifyCaptureUrlKind covers github / x / web", () => {
  assert.equal(classifyCaptureUrlKind("https://github.com/a/b"), "github-readme");
  assert.equal(classifyCaptureUrlKind("https://github.com/a/b/blob/main/x.md"), "github-file");
  assert.equal(classifyCaptureUrlKind("https://x.com/u/status/1"), "x-status");
  assert.equal(classifyCaptureUrlKind("https://example.com/a"), "web");
  assert.equal(urlKindLabelKey("github-readme"), "overlays:capture.urlKindGithubReadme");
});

test("fetchUrl rejects non-http before github routing", async () => {
  await assert.rejects(
    () => fetchOps.fetchUrl({ url: "file:///etc/passwd" }, {}),
    (err) => err.code === "invalid_url",
  );
});
