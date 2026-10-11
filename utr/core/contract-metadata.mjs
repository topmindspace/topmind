import { t } from "./i18n-strings.mjs";

function normalizeField(name, input = {}) {
	return {
		name,
		type: input.type,
		label: input.label || name,
		required: input.required === true,
		placeholder: input.placeholder || "",
		hint: input.hint || input.description || "",
		options: Array.isArray(input.options) ? input.options : [],
	};
}

function engineLabelForSkill(skill) {
	if (skill === "workspace-read") return t("skill.workspace-read");
	if (skill === "workspace-write") return t("skill.workspace-write");
	if (skill === "workspace-transform") return t("skill.workspace-transform");
	if (skill === "workspace-maintain") return t("skill.workspace-maintain");
	if (skill === "contract") return t("skill.contract");
	if (skill === "memory") return t("skill.memory");
	if (skill === "lifecycle") return t("skill.lifecycle");
	if (skill === "derived") return t("skill.derived");
	return skill || t("skill.unknown");
}

export function normalizeArtifactPolicy(artifactPolicy) {
	return {
		createsArtifact: artifactPolicy?.creates_artifact === true,
		artifactTypes: Array.isArray(artifactPolicy?.artifact_types)
			? artifactPolicy.artifact_types
			: [],
		persistedByDefault: artifactPolicy?.persisted_by_default === true,
		notes: artifactPolicy?.notes || "",
	};
}

export function normalizeContractCommand(contract, commandName, command = {}) {
	return {
		kind: contract.kind,
		toolKind: contract.kind,
		command: commandName,
		label: command.label || commandName,
		description: command.description || contract.description || "",
		skill: contract.skill,
		sourceEngine: contract.skill,
		sourceEngineLabel: engineLabelForSkill(contract.skill),
		group: command.group || "assistive",
		exposure: command.exposure || "advanced",
		advanced: command.exposure === "advanced",
		destructive: command.destructive === true,
		workflowNote: command.workflow_note || "",
		riskLevel: command.risk_level || "medium",
		reviewPolicy: command.review_policy || "preview_or_auto",
		requiresTopic: command.requires_topic === true,
		supportsDryRun: command.supports_dry_run === true,
		idempotent: command.idempotent === true,
		reads: Array.isArray(command.reads) ? command.reads : [],
		writes: Array.isArray(command.writes) ? command.writes : [],
		contexts: Array.isArray(command.contexts) ? command.contexts : [],
		recommendedTriggers: Array.isArray(command.recommended_triggers)
			? command.recommended_triggers
			: [],
		inputs: command.inputs || {},
		fields: Object.entries(command.inputs || {}).map(([name, input]) => normalizeField(name, input)),
		artifactPolicy: normalizeArtifactPolicy(command.artifact_policy),
	};
}
