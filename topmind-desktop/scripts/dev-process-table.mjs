/**
 * Read the OS process table for workspace-scoped dev cleanup.
 * The pure filter lives in electron/lib/runtime-bounds.mjs. This file only
 * collects pid + command lines. It never kills a process.
 */
import { spawnSync } from "node:child_process";
import { parsePsCommandTable } from "../electron/lib/runtime-bounds.mjs";

export function readProcessCommandTable() {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    return parsePsCommandTable(String(result.stdout || ""));
  }
  const result = spawnSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8",
    timeout: 8000,
  });
  return parsePsCommandTable(String(result.stdout || ""));
}
