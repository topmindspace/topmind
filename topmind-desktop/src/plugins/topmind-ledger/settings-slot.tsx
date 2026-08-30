import { useTranslation } from "react-i18next";
import type { PluginContext, SettingsSlot } from "../types";
import type { AppSettings } from "../../types";
import { SwitchField, Field, SettingsSection } from "../../components/settings/fields";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { useViewStore } from "../../stores/view-store";
import { LEDGER_PLUGIN_ID, PLUGIN_APP_KIND } from "../../lib/plugin-launcher";

export function createLedgerSettingsSlot(_ctx: PluginContext): SettingsSlot {
  return {
    kind: "settings",
    id: "topmind-ledger.settings",
    label: "Ledger",
    labelKey: "ledger:name",
    icon: "wallet",
    order: 220,
    render: (props) => (
      <LedgerPanel settings={props.settings as AppSettings} update={props.update} />
    ),
  };
}

function LedgerPanel({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (p: Partial<AppSettings>) => void;
}) {
  const { t } = useTranslation(["ledger", "settings"]);
  const l = settings.ledger || { enabled: true, defaultRoleId: "Personal" };
  const openOverlay = useViewStore((s) => s.openOverlay);

  return (
    <div className="space-y-5">
      <SettingsSection title={t("ledger:settings.title")} description={t("ledger:settings.desc")}>
        <SwitchField
          label={t("ledger:settings.enabled")}
          description={t("ledger:settings.enabledDesc")}
          checked={l.enabled !== false}
          onChange={(enabled) => update({ ledger: { ...l, enabled } })}
        />
        <p className="text-3xs text-text-tertiary">{t("ledger:howToOpen")}</p>
        <p className="font-mono text-3xs text-text-quaternary">{t("ledger:bookPathHint")}</p>
        <Field label={t("ledger:settings.defaultRole")} description={t("ledger:settings.defaultRoleDesc")}>
          <Input
            value={l.defaultRoleId || "Personal"}
            onChange={(e) => update({ ledger: { ...l, defaultRoleId: e.target.value } })}
          />
        </Field>
        <Button
          variant="secondary"
          size="sm"
          disabled={l.enabled === false}
          onClick={() => openOverlay(PLUGIN_APP_KIND, { pluginId: LEDGER_PLUGIN_ID })}
        >
          {t("ledger:settings.openApp")}
        </Button>
      </SettingsSection>
    </div>
  );
}
