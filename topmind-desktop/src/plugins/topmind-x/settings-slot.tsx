/**
 * X Settings — compact layers: Bearer read · xurl post · MCP docs for agents.
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  RiExternalLinkLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiTerminalLine,
} from "@remixicon/react";
import { api } from "../../services/api";
import type { PluginContext, SettingsSlot } from "../types";
import type { AppSettings } from "../../types";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/select";
import { Button } from "../../components/ui/Button";
import {
  Field,
  KeyField,
  SettingsSection,
  SwitchField,
  StatusDot,
  HelpTip,
} from "../../components/settings/fields";
import { ICON } from "../../lib/icons";
import { Tooltip } from "../../components/ui/tooltip";

export function createXSettingsSlot(_ctx: PluginContext): SettingsSlot {
  return {
    kind: "settings",
    id: "topmind-x.settings",
    label: "X / Twitter",
    labelKey: "x:name",
    icon: "twitter",
    order: 210,
    render: (props) => <XPanel settings={props.settings as AppSettings} update={props.update} />,
  };
}

type ProbeState = {
  loading: boolean;
  hasCli: boolean;
  xurlVersion: string | null;
  xurlCmd: string | null;
  canPost: boolean;
  installHints: { brew?: string; npm?: string; auth?: string; mcp?: string; docs?: string };
  message: string | null;
};

const DEFAULT_HINTS = {
  brew: "brew install --cask xdevplatform/tap/xurl",
  npm: "npm i -g @xdevplatform/xurl",
  auth: "xurl auth oauth2",
  mcp: "npx -y @xdevplatform/xurl mcp https://api.x.com/mcp",
  docs: "https://docs.x.com/tools/mcp",
};

function XPanel({ settings, update }: { settings: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const { t } = useTranslation("x");
  const x = settings.x;
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeState>({
    loading: true,
    hasCli: false,
    xurlVersion: null,
    xurlCmd: null,
    canPost: false,
    installHints: DEFAULT_HINTS,
    message: null,
  });
  const [copied, setCopied] = useState<string | null>(null);

  const refreshProbe = useCallback(async () => {
    setProbe((p) => ({ ...p, loading: true }));
    try {
      const res = await api.x.probeTools();
      setProbe({
        loading: false,
        hasCli: Boolean(res.xurl?.ok),
        xurlVersion: res.xurl?.version ?? null,
        xurlCmd: res.xurl?.cmd ?? null,
        canPost: Boolean(res.canPost),
        installHints: { ...DEFAULT_HINTS, ...(res.installHints || {}) },
        message: res.message,
      });
    } catch (e) {
      setProbe({
        loading: false,
        hasCli: false,
        xurlVersion: null,
        xurlCmd: null,
        canPost: false,
        installHints: DEFAULT_HINTS,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refreshProbe();
  }, [refreshProbe]);

  const patchX = (partial: Partial<AppSettings["x"]> & { bearerToken?: string | null }) =>
    update({ x: partial } as Partial<AppSettings>);

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await api.x.testConnection();
      setTestMsg(res.ok ? res.message : res.message);
      await refreshProbe();
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const copyCmd = async (cmd: string, key: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* ignore */ }
  };

  const configured = Boolean(x.bearerToken?.trim());
  const hints = probe.installHints;
  const readyLabel = !x.enabled
    ? t("settings.disabled")
    : configured && probe.hasCli
      ? t("settings.readWriteReady")
      : configured
        ? t("settings.readOnlyReady")
        : probe.hasCli
          ? t("settings.postOnlyReady")
          : t("settings.notReady");

  return (
    <div>
      <SettingsSection
        title={t("settings.connectTitle")}
        description={t("settings.connectDesc")}
        help={t("settings.connectHelp")}
        action={<StatusDot ok={x.enabled && (configured || probe.hasCli)} label={readyLabel} />}
      >
        <SwitchField
          label={t("settings.enable")}
          description={t("settings.enableDesc")}
          checked={x.enabled}
          onChange={() => patchX({ enabled: !x.enabled })}
        />
        <KeyField
          label="Bearer Token"
          helpUrl="https://developer.x.com/en/portal/dashboard"
          configured={configured}
          onClear={() => patchX({ bearerToken: null as unknown as string })}
          description={t("settings.bearerDesc")}
        >
          <Input
            type="password"
            value={x.bearerToken}
            onChange={(e) => patchX({ bearerToken: e.target.value })}
            placeholder="AAAA…"
            autoComplete="off"
            disabled={!x.enabled}
          />
        </KeyField>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-3xs text-text-tertiary">
          <span className="inline-flex items-center gap-1">
            {probe.loading ? (
              <RiLoader4Line size={ICON.xs} className="animate-spin" />
            ) : (
              <RiTerminalLine size={ICON.xs} className={probe.hasCli ? "text-success" : "text-warning"} />
            )}
            {probe.loading
              ? t("settings.probingXurl")
              : probe.hasCli
                ? `xurl${probe.xurlVersion ? ` ${probe.xurlVersion}` : ""}`
                : t("settings.xurlNotFound")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-3xs"
            disabled={probe.loading || !x.enabled}
            onClick={() => void refreshProbe()}
          >
            {t("settings.reprobe")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-3xs"
            disabled={testing || !x.enabled}
            onClick={() => void runTest()}
          >
            {testing ? <RiLoader4Line size={ICON.micro} className="animate-spin" /> : null}
            {t("settings.test")}
          </Button>
        </div>
        {testMsg ? (
          <div className="mb-2 text-3xs text-text-tertiary">{testMsg}</div>
        ) : null}
        {!probe.loading && !probe.hasCli && x.enabled ? (
          <div className="space-y-1.5 rounded-[var(--radius-md)] border border-border-subtle bg-surface-muted/30 p-2.5">
            <div className="flex items-center gap-1 text-3xs font-medium text-text-secondary">
              {t("settings.installXurl")}
              <HelpTip content={t("settings.installXurlHelp")} />
            </div>
            {[
              ["brew", hints.brew || DEFAULT_HINTS.brew],
              ["npm", hints.npm || DEFAULT_HINTS.npm],
              ["auth", hints.auth || DEFAULT_HINTS.auth],
            ].map(([key, cmd]) => (
              <div key={key} className="flex items-center gap-1.5 font-mono text-3xs text-text-quaternary">
                <code className="min-w-0 flex-1 truncate rounded bg-surface px-1.5 py-0.5">{cmd}</code>
                <Tooltip content={copied === key ? t("settings.copied") : t("settings.copy")}>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 hover:bg-surface-muted"
                    aria-label={copied === key ? t("settings.copied") : t("settings.copy")}
                    onClick={() => void copyCmd(cmd, key)}
                  >
                    <RiFileCopyLine size={ICON.micro} />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={t("settings.prefsTitle")}
        description={t("settings.prefsDesc")}
      >
        <Field label={t("settings.syncCategory")} description={t("settings.syncCategoryDesc")} compact>
          <Input
            value={x.syncCategory || "auto"}
            disabled={!x.enabled}
            onChange={(e) => patchX({ syncCategory: e.target.value.trim() || "auto" })}
            placeholder="auto"
          />
        </Field>
        <Field label={t("settings.autoArchivePosts")} description={t("settings.autoArchivePostsDesc")} compact>
          <Select
            value={x.autoArchivePosts ? "true" : "false"}
            disabled={!x.enabled}
            onChange={(e) => patchX({ autoArchivePosts: e.target.value === "true" })}
            options={[
              { value: "false", label: t("settings.off") },
              { value: "true", label: t("settings.on") },
            ]}
          />
        </Field>
        <Field
          label={t("settings.mcpUrl")}
          description={t("settings.mcpUrlDesc")}
          compact
        >
          <div className="flex gap-1">
            <Input
              type="url"
              value={x.mcpEndpoint || "https://api.x.com/mcp"}
              disabled={!x.enabled}
              onChange={(e) => update({ x: { ...x, mcpEndpoint: e.target.value } })}
              className="font-mono text-3xs"
            />
            <Tooltip content={copied === "mcp" ? t("settings.copied") : t("settings.copyAgentExample")}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => void copyCmd(hints.mcp || DEFAULT_HINTS.mcp, "mcp")}
              >
                <RiFileCopyLine size={ICON.micro} />
              </Button>
            </Tooltip>
            <Tooltip content={t("settings.officialDocs")}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => void api.sys.openUrl(hints.docs || DEFAULT_HINTS.docs)}
              >
                <RiExternalLinkLine size={ICON.micro} />
              </Button>
            </Tooltip>
          </div>
        </Field>
      </SettingsSection>
    </div>
  );
}
