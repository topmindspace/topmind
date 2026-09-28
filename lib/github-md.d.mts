export type GithubFileRef = {
  owner: string;
  repo: string;
  ref: string;
  path: string;
};

export type GithubRepoReadmeTarget = {
  owner: string;
  repo: string;
  ref?: string;
  subdir?: string;
};

export type CaptureUrlKind =
  | "github-file"
  | "github-readme"
  | "github-other"
  | "x-status"
  | "x-article"
  | "web";

export type CaptureUrlClass =
  | { kind: "github-file"; github: GithubFileRef; labelKey: string }
  | { kind: "github-readme"; github: GithubRepoReadmeTarget; labelKey: string }
  | { kind: "github-other"; labelKey: string }
  | { kind: "x-status"; labelKey: string }
  | { kind: "x-article"; labelKey: string }
  | { kind: "web"; labelKey: string };

export declare const GITHUB_README_NAMES: readonly string[];

export declare function parseGithubFileUrl(raw: string): GithubFileRef | null;
export declare function parseGithubRepoReadmeTarget(raw: string): GithubRepoReadmeTarget | null;
export declare function isGithubMarkdownFileUrl(raw: string): boolean;
export declare function isGithubHostUrl(raw: string): boolean;
export declare function githubBlobUrl(ref: GithubFileRef): string;
export declare function githubRawUrl(ref: GithubFileRef): string;
export declare function githubRawAssetUrl(ref: GithubFileRef, relPath: string): string;
export declare function headingTitleFromMarkdown(markdown: string): string | null;
export declare function titleFromMarkdown(markdown: string, filename: string): string;
export declare function rewriteGithubImageSrc(src: string, ref: GithubFileRef): string;
export declare function rewriteGithubMarkdownImages(markdown: string, ref: GithubFileRef): string;
export declare function classifyCaptureUrl(raw: string): CaptureUrlClass | null;
export declare function preferGithubRawUrl(raw: string): string;
