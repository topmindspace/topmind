export type WritingTaskBlocker =
  | "source"
  | "loading"
  | "source-error"
  | "ai-busy"
  | "session-error"
  | "skills-off"
  | "skill-off"
  | null;

/** Keep the writing action honest about the tools available for this run. */
export function writingTaskBlocker(input: {
  sourcePath: string;
  sourceLoading: boolean;
  sourceError: string;
  aiBusy: boolean;
  sessionError?: boolean;
  skillsEnabled?: boolean;
  enabledSkillIds?: string[] | null;
  actionId: string;
}): WritingTaskBlocker {
  if (!/\.md$/iu.test(input.sourcePath)) return "source";
  if (input.sourceLoading) return "loading";
  if (input.sourceError) return "source-error";
  if (input.aiBusy) return "ai-busy";
  if (input.sessionError) return "session-error";
  if (input.skillsEnabled === false) return "skills-off";
  if (input.enabledSkillIds?.length && !input.enabledSkillIds.includes(input.actionId)) return "skill-off";
  return null;
}
