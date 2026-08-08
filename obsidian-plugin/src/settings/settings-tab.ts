// ── Settings Tab: Plugin configuration UI ──────────────────────────────────

import { PluginSettingTab, Setting, Notice } from "obsidian";
import type TopmindPlugin from "../main";
import { t } from "../i18n";
import type { AiProviderType, WritebackMode, TimelineOrder } from "../types";
import { AI_PROVIDER_PRESETS } from "../constants";

/** Workspace template options */
const TEMPLATE_OPTIONS = [
  { value: "stream", label: "Stream" },
  { value: "balanced", label: "Balanced" },
  { value: "research", label: "Research" },
  { value: "periodic", label: "Periodic" },
] as const;

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

    // ── Section: Workspace Initialization ──
    new Setting(containerEl).setName("📂 " + t("settings_workspace")).setHeading();

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
            } else {
              new Notice(`${t("init_workspace_failed")}: ${result.error}`);
            }
          }),
      );

    // ── Section: Stream Workbench ──
    new Setting(containerEl).setName("🌊 " + t("settings_stream")).setHeading();

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

    // ── Section: AI Co-pilot & Writeback ──
    new Setting(containerEl).setName("🤖 " + t("settings_ai")).setHeading();

    new Setting(containerEl)
      .setName(t("settings_ai_provider"))
      .setDesc(t("settings_ai_provider_desc"))
      .addDropdown((dd) => {
        dd.addOption("none", t("provider_none"))
          .addOption("openai", t("provider_openai"))
          .addOption("deepseek", t("provider_deepseek"))
          .addOption("anthropic", t("provider_anthropic"))
          .addOption("ollama", t("provider_ollama"))
          .addOption("custom", t("provider_custom"))
          .setValue(s.aiProvider)
          .onChange(async (v) => {
            s.aiProvider = v as AiProviderType;
            // Apply preset defaults — always overwrite for known providers
            const preset = AI_PROVIDER_PRESETS[v];
            if (preset) {
              s.aiBaseUrl = preset.baseUrl;
              s.aiModel = preset.model;
            }
            await this.save();
            this.display();
          });
      });

    if (s.aiProvider !== "none") {
      new Setting(containerEl)
        .setName(t("settings_ai_key"))
        .setDesc(t("settings_ai_key_desc"))
        .addText((text) => {
          text
            .setPlaceholder("sk-...")
            .setValue(s.aiApiKey);
          text.inputEl.type = "password";
          text.onChange(async (v) => {
            s.aiApiKey = v;
            await this.save();
          });
        });

      new Setting(containerEl)
        .setName(t("settings_ai_base_url"))
        .setDesc(t("settings_ai_base_url_desc"))
        .addText((text) =>
          text
            .setPlaceholder("https://api.deepseek.com/v1")
            .setValue(s.aiBaseUrl)
            .onChange(async (v) => {
              s.aiBaseUrl = v;
              await this.save();
            }),
        );

      new Setting(containerEl)
        .setName(t("settings_ai_model"))
        .setDesc(t("settings_ai_model_desc"))
        .addText((text) =>
          text
            .setPlaceholder("deepseek-chat")
            .setValue(s.aiModel)
            .onChange(async (v) => {
              s.aiModel = v;
              await this.save();
            }),
        );

      // Connection test button
      new Setting(containerEl)
        .setName(t("settings_ai_test"))
        .setDesc(t("settings_security_note"))
        .addButton((btn) =>
          btn
            .setButtonText(t("settings_ai_test"))
            .onClick(async () => {
              if (!s.aiApiKey && s.aiProvider !== "ollama") {
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
    }

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
    new Setting(containerEl).setName("🛡️ " + t("settings_security")).setHeading();

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

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.kernelService.updateSettings(this.plugin.settings);
  }
}
