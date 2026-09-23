import { useTranslation } from "react-i18next";
import type { PluginContext, SettingsSlot } from "../types";
import type { AppSettings } from "../../types";
import { SwitchField, Field, SettingsSection } from "../../components/settings/fields";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useViewStore } from "../../stores/view-store";
import { WECHAT_PLUGIN_ID, PLUGIN_APP_KIND } from "../../lib/plugin-launcher";
import { WECHAT_THEME_IDS } from "../../lib/wechat-format";

export function createWechatSettingsSlot(_ctx: PluginContext): SettingsSlot {
  return {
    kind: "settings",
    id: "topmind-wechat.settings",
    label: "WeChat",
    labelKey: "wechat:name",
    icon: "file-text",
    order: 221,
    render: (props) => (
      <WechatPanel settings={props.settings as AppSettings} update={props.update} />
    ),
  };
}

function WechatPanel({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
}) {
  const { t } = useTranslation(["wechat", "settings"]);
  const w = settings.wechat || { enabled: true, theme: "minimal-ink" };
  const openOverlay = useViewStore((s) => s.openOverlay);

  return (
    <div className="space-y-5">
      <SettingsSection title={t("wechat:settings.title")} description={t("wechat:settings.desc")}>
        <SwitchField
          label={t("wechat:settings.enabled")}
          description={t("wechat:settings.enabledDesc")}
          checked={w.enabled !== false}
          onChange={(enabled) => update({ wechat: { ...w, enabled } })}
        />
        <p className="text-3xs text-text-tertiary">{t("wechat:howToOpen")}</p>
        <Field label={t("wechat:settings.theme")} description={t("wechat:settings.themeDesc")}>
          <div className="flex flex-wrap gap-1.5">
            {WECHAT_THEME_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => update({ wechat: { ...w, theme: id } })}
                aria-pressed={(w.theme || "minimal-ink") === id}
                className={
                  (w.theme || "minimal-ink") === id
                    ? "rounded-full border border-transparent bg-accent-container px-2.5 py-1 text-3xs font-medium text-on-accent-container v4-focus-ring"
                    : "rounded-full border border-border-subtle-dim px-2.5 py-1 text-3xs text-text-secondary hover:bg-state-hover v4-focus-ring"
                }
              >
                {t(`wechat:themes.${id}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("wechat:settings.packageRoot")} description={t("wechat:settings.packageRootDesc")}>
          <Input
            value={w.packageRoot || ""}
            placeholder={t("wechat:settings.packageRootPlaceholder")}
            onChange={(e) => update({ wechat: { ...w, packageRoot: e.target.value } })}
          />
        </Field>
        <Button
          variant="secondary"
          size="sm"
          disabled={w.enabled === false}
          onClick={() => openOverlay(PLUGIN_APP_KIND, { pluginId: WECHAT_PLUGIN_ID })}
        >
          {t("wechat:settings.openApp")}
        </Button>
      </SettingsSection>
    </div>
  );
}
