#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DESKTOP_PKG_PATH = path.join(ROOT_DIR, 'topmind-desktop', 'package.json');
const CASK_PATH = path.join(ROOT_DIR, 'casks', 'topmind.rb');

function getDesktopVersion() {
  const content = fs.readFileSync(DESKTOP_PKG_PATH, 'utf8');
  const pkg = JSON.parse(content);
  return pkg.version;
}

function calculateSha256(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function generateCaskContent(version, sha256Arm, sha256Intel) {
  const armHash = sha256Arm || '0000000000000000000000000000000000000000000000000000000000000000';
  const intelHash = sha256Intel || '0000000000000000000000000000000000000000000000000000000000000000';

  return `cask "topmind" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${armHash}",
         intel: "${intelHash}"

  url "https://github.com/topmindspace/topmind/releases/download/v#{version}/topmind-#{version}-mac-#{arch}.dmg"
  name "Topmind Desktop"
  desc "Local-first personal knowledge desktop workspace with stream and AI co-pilot"
  homepage "https://github.com/topmindspace/topmind"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  # Remove quarantine attribute automatically on install to solve macOS "damaged" gatekeeper error
  postflight do
    system_command "xattr",
                   args: ["-rd", "com.apple.quarantine", "#{appdir}/Topmind.app"],
                   sudo: false
  end

  app "Topmind.app"

  zap trash: [
    "~/topmind/topmind-desktop/logs",
    "~/Library/Application Support/topmind",
    "~/Library/Preferences/com.topmindspace.topmind.plist",
    "~/Library/Saved Application State/com.topmindspace.topmind.savedState",
  ]
end
`;
}

function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const version = getDesktopVersion();

  const releaseDir = path.join(ROOT_DIR, 'topmind-desktop', 'release');
  const armDmg = path.join(releaseDir, `topmind-${version}-mac-arm64.dmg`);
  const intelDmg = path.join(releaseDir, `topmind-${version}-mac-x64.dmg`);

  const sha256Arm = calculateSha256(armDmg);
  const sha256Intel = calculateSha256(intelDmg);

  const caskContent = generateCaskContent(version, sha256Arm, sha256Intel);

  if (isDryRun) {
    console.log('[dry-run] Generated casks/topmind.rb content:');
    console.log(caskContent);
    return;
  }

  fs.mkdirSync(path.dirname(CASK_PATH), { recursive: true });
  fs.writeFileSync(CASK_PATH, caskContent, 'utf8');
  console.log(`[success] Updated ${path.relative(ROOT_DIR, CASK_PATH)} (version: ${version})`);
}

main();
