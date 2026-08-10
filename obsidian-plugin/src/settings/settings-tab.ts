// ── Settings Tab: Plugin configuration UI ──────────────────────────────────
//
// Multi-provider AI settings — aligned with Desktop's AiProviderPanel design:
//   - All provider keys visible simultaneously (not one-at-a-time)
//   - Grouped: International / Domestic / Local
//   - Help links to each provider's API key page
//   - Status indicators showing which providers are configured
//   - Source preference selector
//   - Import from Desktop capability
//   - Model selection with curated defaults
//   - Workspace status card with contract doctor / reseed

import { PluginSettingTab, Setting, Notice, ExtraButtonComponent } from "obsidian";
import type TopmindPlugin from "../main";
import { t, type LocaleKey } from "../i18n";
import type { WritebackMode, TimelineOrder, AiManualKeys } from "../types";
import { hasConfiguredProvider, getProviderKey } from "../types";
import {
  AI_PROVIDER_PRESETS,
  PROVIDER_GROUPS,
  PROVIDER_DEFAULT_MODELS,
} from "../constants";
import { getModelsForProvider } from "../services/models-dev";
import { reseedWorkspaceContract } from "../services/kernel-workspace-ops";
import { getKernel } from "../bridge/kernel-loader";
import { StreamWorkbenchView } from "../views/stream-workbench-view";
import { SidebarDockView } from "../views/sidebar-dock-view";
import { VIEW_TYPE_STREAM_WORKBENCH, VIEW_TYPE_SIDEBAR_DOCK } from "../constants";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

/** Workspace template options */
const TEMPLATE_OPTIONS = [
  { value: "stream", label: "Stream" },
  { value: "balanced", label: "Balanced" },
  { value: "research", label: "Research" },
  { value: "periodic", label: "Periodic" },
] as const;

/**
 * Attempt to import AI provider keys from Desktop.
 *
 * Checks two sources in order:
 * 1. Desktop's explicit export file (obsidian-key-export.json) — written by
 *    Desktop's Settings → AI → Export for Obsidian button. This works even
 *    when Desktop uses safeStorage encryption (the export decrypts first).
 * 2. Desktop's app-settings.json — only works when safeStorage is unavailable
 *    (keys stored in plaintext) or on Linux without libsecret.
 */
function tryImportDesktopSettings(): { imported: Partial<AiManualKeys>; preference: string; model: string; encrypted: boolean } | null {
  const home = os.homedir();

  // Source 1: Explicit export file (always plaintext, always up-to-date)
  const exportCandidates = [
    path.join(home, "topmind", "topmind-desktop", "state", "obsidian-key-export.json"),
    path.join(home, "topmind-desktop", "state", "obsidian-key-export.json"),
  ];
  for (const exportPath of exportCandidates) {
    if (!fs.existsSync(exportPath)) continue;
    try {
      const raw = fs.readFileSync(exportPath, "utf-8");
      const parsed = JSON.parse(raw);
      const ai = parsed?.ai;
      if (!ai || typeof ai !== "object") continue;
      const m = ai.manual || {};
      const imported: Partial<AiManualKeys> = {};
      if (m.openAiKey) imported.openAiKey = m.openAiKey;
      if (m.anthropicKey) imported.anthropicKey = m.anthropicKey;
      if (m.googleKey) imported.googleKey = m.googleKey;
      if (m.deepseekKey) imported.deepseekKey = m.deepseekKey;
      if (m.moonshotKey) imported.moonshotKey = m.moonshotKey;
      if (m.zhipuKey) imported.zhipuKey = m.zhipuKey;
      if (m.minimaxKey) imported.minimaxKey = m.minimaxKey;
      if (m.xaiKey) imported.xaiKey = m.xaiKey;
      if (m.customBaseUrl) imported.customBaseUrl = m.customBaseUrl;
      if (m.customKey) imported.customKey = m.customKey;
      if (m.ollamaBaseUrl) imported.ollamaBaseUrl = m.ollamaBaseUrl;
      return {
        imported,
        preference: ai.sourcePreference || "",
        model: ai.defaultModel || "",
        encrypted: false,
      };
    } catch {
      // continue to next source
    }
  }

  // Source 2: app-settings.json (works only when keys are in plaintext)
  const candidates = [
    path.join(home, "topmind", "topmind-desktop", "state", "app-settings.json"),
    path.join(home, "topmind-desktop", "state", "app-settings.json"),
  ];

  for (const settingsPath of candidates) {
    if (!fs.existsSync(settingsPath)) continue;
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      const ai = parsed?.ai;
      if (!ai || typeof ai !== "object") return null;

      const m = ai.manual || {};
      const imported: Partial<AiManualKeys> = {};

      const looksEncrypted = (val: unknown): boolean => {
        if (typeof val !== "string" || !val) return false;
        return val.startsWith("v10:") || (/^[A-Za-z0-9+/=]{40,}$/.test(val) && !val.startsWith("sk-") && !val.startsWith("AI"));
      };

      let encrypted = false;
      if (m.openAiKey) { imported.openAiKey = m.openAiKey; if (looksEncrypted(m.openAiKey)) encrypted = true; }
      if (m.anthropicKey) { imported.anthropicKey = m.anthropicKey; if (looksEncrypted(m.anthropicKey)) encrypted = true; }
      if (m.googleKey) { imported.googleKey = m.googleKey; if (looksEncrypted(m.googleKey)) encrypted = true; }
      if (m.deepseekKey) { imported.deepseekKey = m.deepseekKey; if (looksEncrypted(m.deepseekKey)) encrypted = true; }
      if (m.moonshotKey) { imported.moonshotKey = m.moonshotKey; if (looksEncrypted(m.moonshotKey)) encrypted = true; }
      if (m.zhipuKey) { imported.zhipuKey = m.zhipuKey; if (looksEncrypted(m.zhipuKey)) encrypted = true; }
      if (m.minimaxKey) { imported.minimaxKey = m.minimaxKey; if (looksEncrypted(m.minimaxKey)) encrypted = true; }
      if (m.xaiKey) { imported.xaiKey = m.xaiKey; if (looksEncrypted(m.xaiKey)) encrypted = true; }
      if (m.customBaseUrl) imported.customBaseUrl = m.customBaseUrl;
      if (m.customKey) { imported.customKey = m.customKey; if (looksEncrypted(m.customKey)) encrypted = true; }
      if (m.ollamaBaseUrl) imported.ollamaBaseUrl = m.ollamaBaseUrl;

      return {
        imported,
        preference: ai.sourcePreference || "",
        model: ai.defaultModel || "",
        encrypted,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export class TopmindSettingTab extends PluginSettingTab {
  plugin: TopmindPlugin;
  private templateSelect: HTMLSelectElement | null = null;

  constructor(app: import("obsidian").App, plugin: TopmindPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;

    containerEl.empty();
    this.templateSelect = null;

    // ── Section: Workspace & Contract ──
    new Setting(containerEl).setName(t("settings_workspace")).setHeading();

    // Workspace status card
    this.renderWorkspaceStatus();

    new Setting(containerEl)
      .setName(t("init_workspace"))
      .setDesc(t("init_workspace_desc"))
      .addDropdown((dd) => {
        for (const opt of TEMPLATE_OPTIONS) {
          dd.addOption(opt.value, opt.label);
        }
        dd.setValue("stream");
        this.templateSelect = dd.selectEl;
      })
      .addButton((btn) =>
        btn
          .setButtonText(t("init_workspace"))
          .onClick(() => {
            const templateId = this.templateSelect?.value || "stream";
            const result = this.plugin.kernelService.initWorkspace(templateId);
            if (result.ok) {
              new Notice(t("init_workspace_success"));
              this.display();
            } else {
              new Notice(`${t("init_workspace_failed")}: ${result.error}`);
            }
          }),
      );

    // ── Section: Stream Workbench ──
    new Setting(containerEl).setName(t("settings_stream")).setHeading();

    new Setting(containerEl)
      .setName(t("settings_auto_open"))
      .setDesc(t("settings_auto_open_desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.autoOpenWorkbench).onChange(async (v) => {
          s.autoOpenWorkbench = v;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings_timeline_order"))
      .setDesc(t("settings_timeline_order_desc"))
      .addDropdown((dd) =>
        dd
          .addOption("desc", t("timeline_desc"))
          .addOption("asc", t("timeline_asc"))
          .setValue(s.timelineOrder)
          .onChange(async (v) => {
            s.timelineOrder = v as TimelineOrder;
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings_auto_tag"))
      .setDesc(t("settings_auto_tag_desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.autoTag).onChange(async (v) => {
          s.autoTag = v;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings_locale_override"))
      .setDesc(t("settings_locale_override_desc"))
      .addDropdown((dd) =>
        dd
          .addOption("", t("locale_auto"))
          .addOption("zh-CN", "简体中文")
          .addOption("en-US", "English")
          .setValue(s.localeOverride)
          .onChange(async (v) => {
            s.localeOverride = v;
            await this.save();
            const { setLocale } = await import("../i18n");
            const obsLocale = (this.app as unknown as { locale?: string }).locale || "zh-CN";
            setLocale(v || (obsLocale.startsWith("en") ? "en-US" : "zh-CN"));
            this.display();
          }),
      );

    // ── Section: AI Co-pilot & Writeback ──
    new Setting(containerEl).setName(t("settings_ai")).setHeading();

    // Status indicator
    const aiReady = hasConfiguredProvider(s.ai);
    const statusText = aiReady
      ? t("settings_ai_ready")
      : t("settings_ai_not_configured");

    new Setting(containerEl)
      .setName(t("settings_ai_status"))
      .setDesc(t("settings_ai_status_desc"))
      .addText((text) => {
        text.setValue(statusText).setDisabled(true);
        text.inputEl.style.opacity = "0.7";
        text.inputEl.style.fontStyle = aiReady ? "normal" : "italic";
      });

    // Prominent model selection prompt when AI is configured but no model selected
    if (aiReady && !s.ai.defaultModel) {
      const hintSetting = new Setting(containerEl)
        .setName(t("settings_ai_model_select_hint"))
        .setDesc(t("settings_ai_model_select_hint_desc"));
      hintSetting.infoEl.style.color = "var(--text-accent)";
      hintSetting.infoEl.style.fontWeight = "600";
    }

    // Import from Desktop
    new Setting(containerEl)
      .setName(t("settings_ai_import"))
      .setDesc(t("settings_ai_import_desc"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings_ai_import"))
          .onClick(() => {
            const result = tryImportDesktopSettings();
            if (!result) {
              new Notice(t("settings_ai_import_not_found"));
              return;
            }
            if (result.encrypted) {
              new Notice(t("settings_ai_import_encrypted"));
              return;
            }
            const m = s.ai.manual;
            let count = 0;
            for (const [key, val] of Object.entries(result.imported)) {
              if (val && !m[key as keyof AiManualKeys]) {
                m[key as keyof AiManualKeys] = val;
                count++;
              }
            }
            if (result.preference && !s.ai.sourcePreference) {
              s.ai.sourcePreference = result.preference;
            }
            if (result.model && !s.ai.defaultModel) {
              s.ai.defaultModel = result.model;
            }
            if (count > 0) {
              this.save();
              new Notice(t("settings_ai_import_success").replace("{{count}}", String(count)));
              this.display();
            } else {
              new Notice(t("settings_ai_import_nothing"));
            }
          }),
      );

    // Source preference
    const configuredProviders = Object.entries(AI_PROVIDER_PRESETS)
      .filter(([pid]) => {
        if (pid === "custom") return Boolean(s.ai.manual.customBaseUrl && s.ai.manual.customKey);
        if (pid === "ollama") return Boolean(s.ai.manual.ollamaBaseUrl);
        return Boolean(getProviderKey(pid, s.ai.manual));
      });

    new Setting(containerEl)
      .setName(t("settings_ai_preference"))
      .setDesc(t("settings_ai_preference_desc"))
      .addDropdown((dd) => {
        dd.addOption("", t("settings_ai_auto"));
        for (const [pid, meta] of configuredProviders) {
          dd.addOption(pid, meta.label);
        }
        dd.setValue(s.ai.sourcePreference || "").onChange(async (v) => {
          s.ai.sourcePreference = v;
          s.aiProvider = (v || "none") as TopmindPlugin["settings"]["aiProvider"];
          await this.save();
          // Re-render settings so model dropdown updates for the new provider
          this.display();
        });
      });

    // Model selection — always visible when any provider is configured
    const activeProvider = s.ai.sourcePreference || configuredProviders[0]?.[0] || "";
    if (activeProvider && activeProvider !== "none") {
      const preset = AI_PROVIDER_PRESETS[activeProvider];
      const providerLabel = preset?.label || activeProvider;
      const modelSetting = new Setting(containerEl)
        .setName(t("settings_ai_model"))
        .setDesc(t("settings_ai_model_desc") + ` (${providerLabel})`);
      let modelSelectEl: HTMLSelectElement | null = null;
      modelSetting.addDropdown((dd) => {
        dd.addOption("", t("settings_ai_model_default"));
        if (preset?.model) {
          dd.addOption(preset.model, `${preset.model} (${t("settings_ai_model_default")})`);
        }
        // Static fallbacks — will be replaced when models.dev loads
        const fallback = PROVIDER_DEFAULT_MODELS[activeProvider] || [];
        for (const m of fallback) {
          dd.addOption(m.id, m.label);
        }
        dd.setValue(s.ai.defaultModel || "").onChange(async (v) => {
          s.ai.defaultModel = v;
          s.aiModel = v;
          await this.save();
        });
        modelSelectEl = dd.selectEl;
      });
      // Also allow custom model text input
      modelSetting.addText((text) => {
        text
          .setPlaceholder("custom-model-id")
          .setValue(s.ai.defaultModel || "");
        text.inputEl.style.marginLeft = "4px";
        text.inputEl.style.width = "180px";
        text.onChange(async (v) => {
          // Only update if the value is not empty and differs from dropdown
          const trimmed = v.trim();
          if (trimmed && trimmed !== s.ai.defaultModel) {
            s.ai.defaultModel = trimmed;
            s.aiModel = trimmed;
            await this.save();
          }
        });
      });
      // Refresh models button — forces re-fetch from models.dev
      modelSetting.addExtraButton((btn) => {
        btn
          .setIcon("refresh-cw")
          .setTooltip(t("settings_ai_refresh_models"))
          .onClick(async () => {
            if (!modelSelectEl) return;
            btn.setDisabled(true);
            btn.setIcon("loader");
            try {
              // Clear cache and re-fetch
              const { clearModelsDevCache } = await import("../services/models-dev");
              clearModelsDevCache();
              await this.loadDynamicModels(activeProvider, modelSelectEl);
            } finally {
              btn.setDisabled(false);
              btn.setIcon("refresh-cw");
            }
          });
      });
      // Async: fetch from models.dev and update dropdown options
      if (modelSelectEl) {
        this.loadDynamicModels(activeProvider, modelSelectEl);
      }
    }

    // Provider Key Inputs (grouped)
    for (const group of PROVIDER_GROUPS) {
      const groupLabel = t(group.label as LocaleKey);
      new Setting(containerEl).setName(groupLabel).setHeading();

      for (const pid of group.providers) {
        const meta = AI_PROVIDER_PRESETS[pid];
        if (!meta) continue;

        const isConfigured = pid === "custom"
          ? Boolean(s.ai.manual.customBaseUrl && s.ai.manual.customKey)
          : pid === "ollama"
            ? Boolean(s.ai.manual.ollamaBaseUrl)
            : Boolean(getProviderKey(pid, s.ai.manual));

        const setting = new Setting(containerEl)
          .setName(meta.label + (isConfigured ? " ✓" : ""))
          .setDesc("");

        if (meta.helpUrl) {
          setting.setDesc(`${t("settings_ai_key_desc")} — ${meta.helpUrl}`);
        }

        if (pid === "ollama") {
          setting.addText((text) => {
            text
              .setPlaceholder("http://127.0.0.1:11434/v1")
              .setValue(s.ai.manual.ollamaBaseUrl || "");
            text.onChange(async (v) => {
              const wasConfigured = hasConfiguredProvider(s.ai);
              s.ai.manual.ollamaBaseUrl = v;
              await this.save();
              if (!wasConfigured && hasConfiguredProvider(s.ai) && !s.ai.defaultModel) {
                new Notice(t("settings_ai_model_select_hint"));
                this.display();
              }
            });
          });
        } else if (pid === "custom") {
          setting.addText((text) => {
            text
              .setPlaceholder("https://api.example.com/v1")
              .setValue(s.ai.manual.customBaseUrl || "");
            text.onChange(async (v) => {
              s.ai.manual.customBaseUrl = v;
              await this.save();
            });
          });
          setting.addText((text) => {
            text.inputEl.type = "password";
            text
              .setPlaceholder("sk-...")
              .setValue(s.ai.manual.customKey || "");
            text.onChange(async (v) => {
              const wasConfigured = hasConfiguredProvider(s.ai);
              s.ai.manual.customKey = v;
              await this.save();
              if (!wasConfigured && hasConfiguredProvider(s.ai) && !s.ai.defaultModel) {
                new Notice(t("settings_ai_model_select_hint"));
                this.display();
              }
            });
          });
        } else {
          const keyField = pid === "openai" ? "openAiKey"
            : pid === "anthropic" ? "anthropicKey"
            : pid === "google" ? "googleKey"
            : pid === "deepseek" ? "deepseekKey"
            : pid === "moonshot" ? "moonshotKey"
            : pid === "zhipu" ? "zhipuKey"
            : pid === "minimax" ? "minimaxKey"
            : pid === "xai" ? "xaiKey"
            : "";

          if (keyField) {
            setting.addText((text) => {
              text.inputEl.type = "password";
              const placeholder = pid === "anthropic" ? "sk-ant-..."
                : pid === "google" ? "AI..."
                : "sk-...";
              text
                .setPlaceholder(placeholder)
                .setValue(s.ai.manual[keyField as keyof AiManualKeys] || "");
              text.onChange(async (v) => {
                const wasConfigured = hasConfiguredProvider(s.ai);
                s.ai.manual[keyField as keyof AiManualKeys] = v;
                await this.save();
                // When AI transitions from unconfigured to configured, prompt model selection
                if (!wasConfigured && hasConfiguredProvider(s.ai) && !s.ai.defaultModel) {
                  new Notice(t("settings_ai_model_select_hint"));
                  this.display();
                }
              });
            });

            if (isConfigured) {
              setting.addExtraButton((btn: ExtraButtonComponent) => {
                btn
                  .setIcon("x")
                  .setTooltip(t("settings_ai_clear_key"))
                  .onClick(async () => {
                    s.ai.manual[keyField as keyof AiManualKeys] = "";
                    await this.save();
                    this.display();
                  });
              });
            }
          }
        }
      }
    }

    // Connection test
    new Setting(containerEl)
      .setName(t("settings_ai_test"))
      .setDesc(t("settings_security_note"))
      .addButton((btn) =>
        btn
          .setButtonText(t("settings_ai_test"))
          .onClick(async () => {
            if (!hasConfiguredProvider(s.ai)) {
              new Notice(t("settings_ai_test_no_key"));
              return;
            }
            btn.setButtonText(t("settings_ai_testing"));
            btn.setDisabled(true);
            try {
              const provider = this.plugin.kernelService.testAiConnection();
              const reply = await provider.generate("Reply with: OK", { operation: "test" });
              if (reply && reply.trim().length > 0) {
                new Notice(t("settings_ai_test_success"));
              } else {
                new Notice(`${t("settings_ai_test_failed")}: empty response`);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(`${t("settings_ai_test_failed")}: ${msg}`);
            } finally {
              btn.setButtonText(t("settings_ai_test"));
              btn.setDisabled(false);
            }
          }),
      );

    // Writeback mode
    new Setting(containerEl)
      .setName(t("settings_writeback_mode"))
      .setDesc(t("settings_writeback_mode_desc"))
      .addDropdown((dd) =>
        dd
          .addOption("auto", t("writeback_auto"))
          .addOption("confirm", t("writeback_confirm"))
          .setValue(s.writebackMode)
          .onChange(async (v) => {
            s.writebackMode = v as WritebackMode;
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings_auto_suggest"))
      .setDesc(t("settings_auto_suggest_desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.autoSuggest).onChange(async (v) => {
          s.autoSuggest = v;
          await this.save();
        }),
      );

    new Setting(containerEl)
      .setName(t("settings_auto_maintain_todos"))
      .setDesc(t("settings_auto_maintain_todos_desc"))
      .addToggle((toggle) =>
        toggle.setValue(s.autoMaintainTodos).onChange(async (v) => {
          s.autoMaintainTodos = v;
          await this.save();
        }),
      );

    // ── Section: Security & Archive ──
    new Setting(containerEl).setName(t("settings_security")).setHeading();

    new Setting(containerEl)
      .setName(t("settings_backup_keep"))
      .setDesc(t("settings_backup_keep_desc"))
      .addSlider((slider) =>
        slider
          .setLimits(0, 10, 1)
          .setValue(s.backupKeep)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.backupKeep = v;
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings_receipt_keep"))
      .setDesc(t("settings_receipt_keep_desc"))
      .addSlider((slider) =>
        slider
          .setLimits(10, 200, 10)
          .setValue(s.receiptKeep)
          .setDynamicTooltip()
          .onChange(async (v) => {
            s.receiptKeep = v;
            await this.save();
          }),
      );
  }

  /**
   * Render workspace status card showing contract state and categories.
   */
  private renderWorkspaceStatus(): void {
    const { containerEl } = this;
    const isReady = this.plugin.kernelService.isWorkspaceReady();

    if (!isReady) {
      const statusSetting = new Setting(containerEl)
        .setName(t("workspace_status"))
        .setDesc(t("workspace_not_ready"));
      statusSetting.controlEl.createSpan({ cls: "tm-status-badge tm-status-warning", text: t("workspace_not_ready") });
      return;
    }

    try {
      const model = this.plugin.kernelService.getResolvedModel();
      const categories = model.categories || [];
      const categoryCount = categories.filter((c) => !(c as { hidden?: boolean }).hidden).length;

      const statusSetting = new Setting(containerEl)
        .setName(t("workspace_status"))
        .setDesc(t("workspace_categories_count").replace("{{count}}", String(categoryCount)));

      const badgeContainer = statusSetting.controlEl.createDiv({ cls: "tm-status-badges" });
      badgeContainer.createSpan({ cls: "tm-status-badge tm-status-ok", text: t("workspace_ready") });
      badgeContainer.createSpan({ cls: "tm-status-badge tm-status-info", text: t("workspace_contract_valid") });

      // Contract doctor + reseed buttons
      new Setting(containerEl)
        .setName(t("workspace_contract_doctor"))
        .setDesc(t("workspace_contract_doctor_desc"))
        .addButton((btn) =>
          btn
            .setButtonText(t("workspace_contract_doctor"))
            .onClick(() => {
              try {
                const kernel = getKernel();
                const workspaceRoot = this.plugin.kernelService.getVaultPath();
                const inspect = kernel.inspectContract?.(workspaceRoot);
                if (!inspect) {
                  new Notice(t("workspace_contract_doctor_failed"));
                  return;
                }
                if (inspect.onDiskValid) {
                  new Notice(t("workspace_contract_doctor_ok"));
                } else {
                  const ensured = kernel.ensureContract?.(workspaceRoot, {});
                  if (ensured?.onDiskValid) {
                    new Notice(t("workspace_contract_doctor_fixed"));
                    this.plugin.kernelService.invalidateCache();
                    this.display();
                  } else {
                    new Notice(`${t("workspace_contract_doctor_failed")}: ${inspect.errors?.[0] || ""}`);
                  }
                }
              } catch (err) {
                new Notice(`${t("workspace_contract_doctor_failed")}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }),
        )
        .addButton((btn) =>
          btn
            .setButtonText(t("workspace_contract_reseed"))
            .setWarning()
            .onClick(() => {
              try {
                const result = reseedWorkspaceContract(
                  getKernel(),
                  this.plugin.kernelService.getVaultPath(),
                );
                if (result.ok) {
                  new Notice(t("workspace_contract_reseed_ok"));
                  this.plugin.kernelService.invalidateCache();
                  this.display();
                } else {
                  new Notice(`${t("workspace_contract_reseed_failed")}: ${result.error || ""}`);
                }
              } catch (err) {
                new Notice(`${t("workspace_contract_reseed_failed")}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }),
        );
    } catch {
      // Model resolution failed — just show basic status
      new Setting(containerEl)
        .setName(t("workspace_status"))
        .setDesc(t("workspace_no_categories"));
    }
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.kernelService.updateSettings(this.plugin.settings);
    // Refresh open views so Stream/Sidebar pick up AI config changes
    this.refreshViews();
  }

  /** Refresh all open topmind views to pick up settings changes */
  private refreshViews(): void {
    const leaves = [
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_STREAM_WORKBENCH),
      ...this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR_DOCK),
    ];
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof StreamWorkbenchView) {
        void view.refresh();
      } else if (view instanceof SidebarDockView) {
        void view.refresh();
      }
    }
  }

  /** Async-load models from models.dev and update the dropdown in-place.
   * Replaces static fallback options with the live community catalog. */
  private async loadDynamicModels(providerId: string, selectEl: HTMLSelectElement): Promise<void> {
    try {
      const models = await getModelsForProvider(providerId);
      if (models.length === 0) return;

      // Preserve current value
      const currentValue = selectEl.value;
      const preset = AI_PROVIDER_PRESETS[providerId];
      const presetModel = preset?.model || null;

      // Remove old non-default, non-preset options (static fallbacks)
      const toRemove: HTMLOptionElement[] = [];
      for (const opt of selectEl.options) {
        if (opt.value === "") continue;
        if (presetModel && opt.value === presetModel) continue;
        toRemove.push(opt);
      }
      for (const opt of toRemove) opt.remove();

      // Add models.dev entries (skip duplicates)
      const existing = new Set(Array.from(selectEl.options).map((o) => o.value));
      for (const m of models) {
        if (existing.has(m.id)) continue;
        selectEl.createEl("option", { value: m.id, text: m.label });
        existing.add(m.id);
      }

      // Restore selection
      selectEl.value = currentValue;
    } catch {
      // models.dev fetch failed — static fallbacks remain in place
    }
  }
}
