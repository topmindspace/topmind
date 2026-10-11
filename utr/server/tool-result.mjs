/**
 * MCP tools/call result formatter.
 *
 * Graded confirm (aligned with Kernel evaluateWritePermission) is the only
 * authorization model: content writes land; lifecycle returns
 * `needsConfirm`/`pending`/`planned` and the client re-invokes with
 * `confirmed: true`. There is no second review-session store.
 */

/**
 * @param {object} result executeTool result envelope
 * @returns {{ content: Array<{ type: "text", text: string }>, isError: boolean }}
 */
export function formatToolResult(result) {
  const payload = {
    status: result.ok ? "success" : (result.needsConfirm || result.pending ? "needs_confirm" : "error"),
    kind: result.kind,
    command: result.command,
    ...(result.parsed ? { data: result.parsed } : {}),
    ...(result.stdout ? { stdout: result.stdout.substring(0, 8000) } : {}),
    ...(result.stderr ? { stderr: result.stderr.substring(0, 4000) } : {}),
    ...(result.validationErrors ? { validationErrors: result.validationErrors } : {}),
    ...(result.affectedFiles ? { affectedFiles: result.affectedFiles } : {}),
    ...(result.needsConfirm ? { needsConfirm: true } : {}),
    ...(result.pending ? { pending: true } : {}),
    ...(result.planned ? { planned: result.planned } : {}),
    ...(result.note ? { note: result.note } : {}),
    wroteFiles: result.wroteFiles,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    isError: !result.ok && !result.needsConfirm && !result.pending,
  };
}
