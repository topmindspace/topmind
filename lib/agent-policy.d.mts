export declare const WRITEBACK_MODES: readonly string[];
export declare const AGENT_STEPS_MIN: number;
export declare const AGENT_STEPS_MAX: number;
export declare const AGENT_STEPS_DEFAULT: number;
export declare const MAX_AUTO_CONTINUES: number;
export declare function clampMaxAgentSteps(value: unknown): number;
export declare function normalizeWritebackMode(mode?: string): "auto" | "confirm";
export declare function describeWritebackModeForPrompt(mode?: string, locale?: string): string;
export declare const MODEL_A_FORBIDDEN_RE: RegExp;
