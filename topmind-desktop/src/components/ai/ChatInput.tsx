import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import {
  RiArrowUpLine,
  RiBrainLine,
  RiCheckboxBlankLine,
  RiCompass3Line,
  RiEdit2Line,
  RiLightbulbLine,
  RiListCheck2,
  RiMoreLine,
  RiRepeat2Line,
  RiSparklingLine,
  RiToolsLine,
} from "@remixicon/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAiStore } from "../../stores/ai-store";
import { useViewStore } from "../../stores/view-store";
import { api } from "../../services/api";
import { Button } from "../ui/Button";
import type { SelectGroup } from "../ui/select";
import { MenuSelect } from "../ui/menu-select";
import { Tooltip } from "../ui/tooltip";
import { EmptyState } from "../ui/view";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { streamStatusLabel } from "../../lib/stream-status";
import { DropdownItem, DropdownMenu } from "../ui/DropdownMenu";



/** Default slash map; hydrated from engine skills pack when available.
 *  Labels and tips are i18n keys resolved at call time for locale-aware rendering. */
function getDefaultSkillSlash(t: TFunction): Record<string, { label: string; tip: string; prompt: string; skillId?: string }> {
  return {
    "/capture": {
      label: t("ai:slash.captureLabel"),
      tip: t("ai:slash.captureTip"),
      prompt: t("ai:slash.capturePrompt"),
      skillId: "topmind-capture",
    },
    "/organize": {
      label: t("ai:slash.organizeLabel"),
      tip: t("ai:slash.organizeTip"),
      prompt: t("ai:slash.organizePrompt"),
      skillId: "topmind-organize",
    },
    "/write": {
      label: t("ai:slash.writeLabel"),
      tip: t("ai:slash.writeTip"),
      prompt: t("ai:slash.writePrompt"),
      skillId: "topmind-write",
    },
    "/memory": {
      label: t("ai:slash.memoryLabel"),
      tip: t("ai:slash.memoryTip"),
      prompt: t("ai:slash.memoryPrompt"),
      skillId: "topmind-memory",
    },
    "/maintain": {
      label: t("ai:slash.maintainLabel"),
      tip: t("ai:slash.maintainTip"),
      prompt: t("ai:slash.maintainPrompt"),
      skillId: "topmind-maintain",
    },
    "/loop": {
      label: t("ai:slash.loopLabel"),
      tip: t("ai:slash.loopTip"),
      prompt: t("ai:slash.loopPrompt"),
      skillId: "topmind-loop",
    },
    "/topmind": {
      label: t("ai:slash.topmindLabel"),
      tip: t("ai:slash.topmindTip"),
      prompt: t("ai:slash.topmindPrompt"),
      skillId: "topmind",
    },
  };
}

/** Icon map for default skills — keyed by skillId. */
const SKILL_ICONS: Record<string, typeof RiLightbulbLine> = {
  "topmind-capture": RiLightbulbLine,
  "topmind-organize": RiListCheck2,
  "topmind-write": RiEdit2Line,
  "topmind-memory": RiBrainLine,
  "topmind-maintain": RiToolsLine,
  "topmind-loop": RiRepeat2Line,
  "topmind": RiCompass3Line,
};

/** Responsive skills row — icon+text when wide, icon-only when narrow, overflow to "more". */
function SkillButtonsRow({
  entries,
  onApply,
  disabled,
  t,
}: {
  entries: [string, { label: string; tip: string; prompt: string; skillId?: string }][];
  onApply: (key: string) => void;
  disabled: boolean;
  t: TFunction;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [iconOnly, setIconOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(entries.length);
  const [moreOpen, setMoreOpen] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((obs) => {
      const w = obs[0]?.contentRect.width ?? el.clientWidth;
      // Width thresholds: icon+text ≈ 80px per button, icon-only ≈ 32px
      const fullMode = w >= 320;
      const compactMode = w >= 180;
      setIconOnly(!fullMode);
      if (fullMode) {
        // icon+text: ~80px per button + 28px for more button
        const fit = Math.max(1, Math.floor((w - 36) / 84));
        setVisibleCount(Math.min(entries.length, fit));
      } else if (compactMode) {
        // icon-only: ~32px per button + 28px for more
        const fit = Math.max(1, Math.floor((w - 36) / 36));
        setVisibleCount(Math.min(entries.length, fit));
      } else {
        setVisibleCount(Math.max(1, Math.floor(w / 36)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [entries.length]);

  const direct = entries.slice(0, visibleCount);
  const overflow = entries.slice(visibleCount);

  return (
    <div ref={containerRef} className="flex flex-nowrap items-center gap-1 overflow-hidden">
      {direct.map(([key, v]) => {
        const Icon = v.skillId ? SKILL_ICONS[v.skillId] : null;
        return (
          <Tooltip key={key} content={`${key}\n${v.tip}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApply(key)}
              className="v4-chip shrink-0"
            >
              {Icon ? <Icon size={ICON.micro} className="shrink-0" /> : null}
              {!iconOnly ? <span className="truncate">{v.label}</span> : null}
            </button>
          </Tooltip>
        );
      })}
      {overflow.length > 0 ? (
        <DropdownMenu
          open={moreOpen}
          onOpenChange={setMoreOpen}
          align="end"
          minWidth={160}
          matchTriggerWidth={false}
          trigger={
            <Tooltip content={t("ai.skillsMore")}>
              <button
                type="button"
                className="v4-chip shrink-0"
                disabled={disabled}
                aria-label={t("ai.skillsMore")}
              >
                <RiMoreLine size={ICON.micro} />
              </button>
            </Tooltip>
          }
        >
          {overflow.map(([key, v]) => {
            const Icon = v.skillId ? SKILL_ICONS[v.skillId] : null;
            return (
              <DropdownItem
                key={key}
                onSelect={() => {
                  onApply(key);
                  setMoreOpen(false);
                }}
              >
                {Icon ? <Icon size={ICON.micro} className="shrink-0 opacity-70" /> : null}
                <span className="flex-1">{v.label}</span>
                <code className="text-3xs text-text-quaternary">{key}</code>
              </DropdownItem>
            );
          })}
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function ChatInput() {
  const { t } = useTranslation("editor");
  const [text, setText] = useState("");
  const streaming = useAiStore((s) => s.streaming);
  const sendOrSteer = useAiStore((s) => s.sendOrSteer);
  const cancelStream = useAiStore((s) => s.cancelStream);
  const ready = useAiStore((s) => s.runtimeStatus?.ready ?? false);
  const streamStatus = useAiStore((s) => s.streamStatus);
  const streamToolCount = useAiStore((s) => s.streamToolCount);
  const streamMaxSteps = useAiStore((s) => s.streamMaxSteps);
  const streamToolName = useAiStore((s) => s.streamToolName);
  const lastSteerPreview = useAiStore((s) => s.lastSteerPreview);
  const pendingFollowUpCount = useAiStore((s) => s.pendingFollowUpCount);
  const model = useAiStore((s) => s.model);
  const setModel = useAiStore((s) => s.setModel);
  const providers = useAiStore((s) => s.modelCatalog);
  const runtimeProviders = useAiStore((s) => s.runtimeStatus?.providers ?? null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  const openOverlay = useViewStore((s) => s.openOverlay);
  const selection = useViewStore((s) => s.selection);
  const activeSkillId = useAiStore((s) => s.activeSkillId);
  const setActiveSkillId = useAiStore((s) => s.setActiveSkillId);
  const sessionLoadedSkills = useAiStore((s) => s.sessionLoadedSkills);

  /**
   * Composer model list = configured providers only (same set as settings keys / runtimeStatus).
   * Full models.dev catalog stays available in Settings for browsing before keys exist.
   */
  const configuredProviders = useMemo(() => {
    if (!runtimeProviders?.length) return providers;
    // Runtime status uses { source, label }; catalog uses { id, label, models }
    const ready = new Set(
      runtimeProviders
        .map((p) => {
          const row = p as { source?: string; id?: string };
          return row.source || row.id || "";
        })
        .filter(Boolean),
    );
    const filtered = providers.filter((p) => ready.has(p.id));
    return filtered.length > 0 ? filtered : providers;
  }, [providers, runtimeProviders]);

  /** Compact model labels — strip provider echo / verbose vendor names for the dropdown. */
  const modelGroups: SelectGroup[] = useMemo(
    () =>
      configuredProviders.map((p) => {
        const options = p.models.map((m) => {
          let label = m.label || m.id;
          // Prefer short id when label is long or duplicates provider
          if (label.length > 28 || label.toLowerCase().includes(p.id.toLowerCase())) {
            label = m.id.length <= 28 ? m.id : `${m.id.slice(0, 26)}…`;
          }
          return { value: `${p.id}/${m.id}`, label };
        });
        // Keep a selected custom id visible when the dynamic list arrives
        if (model) {
          const slash = model.indexOf("/");
          const pid = slash > 0 ? model.slice(0, slash) : "";
          const mid = slash > 0 ? model.slice(slash + 1) : model;
          if (pid === p.id && mid && !options.some((o) => o.value === model)) {
            options.push({ value: model, label: mid });
          }
        }
        return { label: p.label, options };
      }),
    [configuredProviders, model],
  );

  // Seed model from settings default once catalog is ready (prefer configured provider)
  useEffect(() => {
    if (model || configuredProviders.length === 0) return;
    void api.sys
      .settings()
      .then((s) => {
        if (useAiStore.getState().model) return;
        const dm = s.ai?.defaultModel;
        const pref = s.ai?.sourcePreference;
        if (pref && dm) {
          const hit = configuredProviders.find((p) => p.id === pref);
          if (hit) {
            setModel(`${pref}/${dm}`);
            return;
          }
        }
        if (dm) {
          const provider = configuredProviders.find((p) => p.models.some((m) => m.id === dm));
          if (provider) {
            setModel(`${provider.id}/${dm}`);
            return;
          }
        }
        // Fallback: first configured provider + its first model
        const first = configuredProviders[0];
        const firstModel = first?.models?.[0]?.id;
        if (first && firstModel) setModel(`${first.id}/${firstModel}`);
      })
      .catch(() => {});
  }, [configuredProviders, model, setModel]);

  // If selection points at an unconfigured provider (stale), snap back to settings default
  useEffect(() => {
    if (!model || configuredProviders.length === 0) return;
    const slash = model.indexOf("/");
    const providerId = slash > 0 ? model.slice(0, slash) : "";
    if (!providerId) return;
    if (configuredProviders.some((p) => p.id === providerId)) return;
    const first = configuredProviders[0];
    const firstModel = first?.models?.[0]?.id;
    if (first && firstModel) setModel(`${first.id}/${firstModel}`);
  }, [model, configuredProviders, setModel]);

  const handleModelChange = (v: string | null) => {
    setModel(v);
    if (v) {
      const slash = v.indexOf("/");
      const providerId = slash > 0 ? v.slice(0, slash) : "";
      const modelId = slash > 0 ? v.slice(slash + 1) : "";
      if (providerId && modelId) {
        void api.sys
          .update({ ai: { sourcePreference: providerId, defaultModel: modelId } })
          .catch(() => {});
      }
    } else {
      void api.sys.update({ ai: { defaultModel: null } }).catch(() => {});
    }
  };

  const [slashHints, setSlashHints] = useState<string[]>([]);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [skillSlash, setSkillSlash] = useState(() => getDefaultSkillSlash(t));
  const [skillOptions, setSkillOptions] = useState<{ id: string; label: string }[]>([
    { id: "", label: t("ai.auto") },
  ]);

  useEffect(() => {
    void api.sys
      .getSkillsStatus()
      .then((st) => {
        if (st.slash?.length) {
          const next = { ...getDefaultSkillSlash(t) };
          for (const row of st.slash) {
            const cmd = row.command.startsWith("/") ? row.command : `/${row.command}`;
            next[cmd] = {
              label: row.skillId.replace(/^topmind-?/, "") || row.skillId,
              tip: `${row.skillId} · skill-first`,
              prompt: row.prompt,
              skillId: row.skillId,
            };
          }
          setSkillSlash(next);
        }
        const cat = st.enabledCatalog || st.catalog || [];
        setSkillOptions([
          { id: "", label: t("ai.auto") },
          ...cat.map((s) => ({
            id: s.id,
            label: s.entrypoint ? `${s.id.replace(/^topmind-?/, "")} ★` : s.id.replace(/^topmind-?/, "") || s.id,
          })),
        ]);
      })
      .catch(() => {});
  }, [t]);

  const applySlash = (key: string) => {
    const skill = skillSlash[key];
    if (!skill) return;
    if (skill.skillId) setActiveSkillId(skill.skillId);
    setText(skill.prompt);
    setSlashHints([]);
    setShowSkills(false);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const keys = Object.keys(skillSlash).filter((k) => k.startsWith(trimmed.toLowerCase()));
      setSlashHints(keys);
    } else {
      setSlashHints([]);
    }
  }, [text, skillSlash]);

  const handleSubmit = useCallback((mode: "steer" | "followUp" = "steer") => {
    const trimmed = text.trim();
    if (!trimmed || !ready) return;
    // While streaming: Enter = steer (mid-turn); Alt+Enter = follow-up (after turn).
    if (streaming) {
      setText("");
      setSlashHints([]);
      void sendOrSteer(trimmed, mode);
      return;
    }
    setText("");
    setSlashHints([]);
    void sendOrSteer(trimmed, "steer");
  }, [text, streaming, ready, sendOrSteer]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (composingRef.current || e.nativeEvent.isComposing) return;
      if (!streaming && slashHints.length === 1) {
        e.preventDefault();
        applySlash(slashHints[0]);
        return;
      }
      e.preventDefault();
      // Alt/Option+Enter while streaming → queue follow-up; plain Enter → steer or send
      handleSubmit(e.altKey && streaming ? "followUp" : "steer");
    }
    if (e.key === "Tab" && slashHints.length > 0 && !streaming) {
      e.preventDefault();
      applySlash(slashHints[0]);
    }
  };


  const canSend = text.trim().length > 0 && ready;

  // 焦点信息 — 从 selection 提取当前上下文用于 placeholder。
  // 名字截断到 12 字符：placeholder 单行显示，过长会被 rows=1 裁切。
  const focusHint = useMemo(() => {
    const cap = (raw: string) => {
      const name = raw.trim();
      if (!name) return "";
      return name.length > 10 ? `${name.slice(0, 10)}…` : name;
    };
    if (selection.kind === "topic") {
      const name = cap(selection.topicId?.split("/").slice(1).join("/") || selection.topicId || "");
      return name ? t("ai.focusPrefix", { name }) : "";
    }
    if (selection.kind === "file") {
      const fileName = cap(selection.path.split("/").pop() || selection.path);
      return fileName ? t("ai.focusPrefix", { name: fileName }) : "";
    }
    if (selection.kind === "connector") {
      const id = cap(selection.id);
      return id ? t("ai.focusPrefix", { name: id }) : "";
    }
    return "";
  }, [selection, t]);

  if (!ready) {
    return (
      <div className="v4-composer">
        <EmptyState
          compact
          icon={<RiSparklingLine size={ICON.md} />}
          title={t("ai.notReadyTitle")}
          hint={t("ai.notReadyHint")}
          action={
            <Tooltip content={t("ai.openSettingsTooltip")}>
              <Button
                size="sm"
                onClick={() => openOverlay("settings", { topicId: "ai" })}
              >
                {t("ai.openSettingsLabel")}
              </Button>
            </Tooltip>
          }
        />
      </div>
    );
  }

  const statusHint = streaming
    ? streamStatus === "calling-tool"
      ? `${streamToolName || t("ai.toolLabel", { name: "…" })}${streamToolCount && streamMaxSteps ? ` ${streamToolCount}/${streamMaxSteps}` : streamToolCount ? ` ${streamToolCount}` : ""}`
      : streamStatus === "steering"
        ? t("ai.steeringQueued")
        : streamStatusLabel(streamStatus || "thinking", streamToolName, streamToolCount, streamMaxSteps)
    : null;

  return (
    <div className="v4-composer">
      {/* Compact tool row: skill · skills · model (no solo footer row) */}
      <div className="v4-composer-toolbar">
        <Tooltip
          content={t("ai.skillTooltip")}
          disabled={skillMenuOpen || streaming}
        >
          <span className="inline-flex min-w-0 max-w-[7.5rem]">
            <MenuSelect
              variant="chip"
              value={activeSkillId || ""}
              disabled={streaming}
              aria-label={t("ai.skillAria")}
              onChange={(v) => setActiveSkillId(v || null)}
              onOpenChange={setSkillMenuOpen}
              options={skillOptions.map((o) => ({ value: o.id, label: o.label }))}
              placeholder={t("ai.skillPlaceholder")}
              minWidth={160}
              maxHeight={280}
              className={cn(activeSkillId && "border-accent-border-subtle bg-accent-bg-subtle text-accent-color")}
            />
          </span>
        </Tooltip>

        {/* Skills toggle — doubles as loaded-skills badge carrier */}
        <Tooltip content={showSkills ? t("ai.skillsTooltip") : t("ai.skillsTooltipExpand")}>
          <button
            type="button"
            onClick={() => setShowSkills((v) => !v)}
            data-active={showSkills}
            className="v4-chip relative shrink-0"
            aria-expanded={showSkills}
            aria-label={t("ai.skillsLabel")}
          >
            <RiSparklingLine size={ICON.micro} />
            {sessionLoadedSkills.length > 0 ? (
              <span
                className="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-accent-color px-0.5 text-5xs font-bold leading-none text-primary-foreground"
                aria-hidden
              >
                {sessionLoadedSkills.length}
              </span>
            ) : null}
          </button>
        </Tooltip>
        {sessionLoadedSkills.length > 0 ? (
          <Tooltip content={t("ai.loadedSkillsTooltip", { skills: sessionLoadedSkills.join(", ") })}>
            <span className="sr-only">{sessionLoadedSkills.length}</span>
          </Tooltip>
        ) : null}

        {/* Model chip — right-aligned, compact */}
        <div className="ml-auto min-w-0 max-w-[min(100%,10rem)] shrink">
          {ready && modelGroups.length > 0 ? (
            <MenuSelect
              variant="chip"
              value={model ?? ""}
              onChange={(v) => handleModelChange(v || null)}
              groups={modelGroups}
              placeholder={t("ai.selectModelPlaceholder")}
              aria-label={t("ai.selectModelAria")}
              align="end"
              minWidth={260}
              maxHeight={360}
              matchTriggerWidth={false}
              searchable
              className="max-w-full font-mono tracking-tight"
            />
          ) : (
            <span className="truncate text-3xs text-text-quaternary">
              {ready ? t("ai.loadingModels") : t("ai.offline")}
            </span>
          )}
        </div>
      </div>

      {showSkills ? (
        <SkillButtonsRow
          entries={Object.entries(skillSlash)}
          onApply={applySlash}
          disabled={streaming}
          t={t}
        />
      ) : null}

      {slashHints.length > 0 ? (
        <div className="rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface p-1 shadow-sm">
          {slashHints.map((k) => (
            <button
              key={k}
              type="button"
              className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-3xs text-text-secondary hover:bg-surface-muted"
              onClick={() => applySlash(k)}
            >
              <code className="font-mono text-accent-color">{k}</code>
              <span className="min-w-0 flex-1 truncate text-text-quaternary">
                {skillSlash[k]?.tip?.split("\n")[0] || skillSlash[k]?.label}
              </span>
              <kbd className="v4-kbd shrink-0">Tab</kbd>
            </button>
          ))}
        </div>
      ) : null}

      {lastSteerPreview || pendingFollowUpCount > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 px-0.5 text-3xs text-text-quaternary">
          {lastSteerPreview ? (
            <span className="max-w-full truncate rounded border border-accent-border-subtle bg-accent-bg-subtle/40 px-1.5 py-0.5 text-accent-color">
              {t("ai.steerHint", { text: lastSteerPreview })}
            </span>
          ) : null}
          {pendingFollowUpCount > 0 ? (
            <span className="rounded border border-border-subtle bg-surface-muted/60 px-1.5 py-0.5">
              {t("ai.followUpQueued", { count: pendingFollowUpCount })}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="v4-composer-field">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            streaming
              ? t("ai.slashPlaceholderStreaming", { hint: statusHint || t("ai.processing") })
              : focusHint
                ? `${focusHint}${t("ai.focusPlaceholderSuffix")}`
                : t("ai.slashPlaceholder")
          }
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-relaxed text-text-primary outline-none",
            "placeholder:text-text-quaternary",
            "max-h-[160px]",
          )}
        />
        {streaming ? (
          <div className="mb-1.5 mr-1.5 flex shrink-0 items-center gap-1">
            {canSend ? (
              <Tooltip content={t("ai.enterSteerLabel")}>
                <button
                  type="button"
                  onClick={() => handleSubmit("steer")}
                  aria-label={t("ai.enterSteerLabel")}
                  className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-primary text-primary-foreground shadow-[var(--shadow-button)] hover:bg-primary-hover active:scale-95"
                >
                  <RiArrowUpLine size={ICON.sm} />
                </button>
              </Tooltip>
            ) : null}
            <Tooltip content={t("ai.stopGeneration")}>
              <Button
                variant="destructive"
                size="icon"
                onClick={() => void cancelStream()}
                className="h-7 w-7"
              >
                <RiCheckboxBlankLine size={ICON.xs} className="fill-current" />
              </Button>
            </Tooltip>
          </div>
        ) : (
          <Tooltip content={canSend ? t("ai.enterSendLabel") : t("ai.enterSendDisabled")}>
            <button
              type="button"
              onClick={() => handleSubmit("steer")}
              disabled={!canSend}
              aria-label={canSend ? t("ai.enterSendLabel") : t("ai.enterSendDisabled")}
              className={cn(
                "mb-1.5 mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-[background-color,color,box-shadow,transform] duration-[var(--duration-fast)]",
                canSend
                  ? "bg-primary text-primary-foreground shadow-[var(--shadow-button)] hover:bg-primary-hover hover:shadow-[var(--shadow-button-hover)] active:scale-95"
                  : "cursor-not-allowed bg-surface-muted text-text-quaternary",
              )}
            >
              <RiArrowUpLine size={ICON.sm} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
