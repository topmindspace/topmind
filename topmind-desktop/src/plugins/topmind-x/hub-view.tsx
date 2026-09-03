/**
 * X connector hub — fetch with preview selection, post, status.
 * Selection: { kind: "connector", id: "x" }
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  RiArrowRightSLine,
  RiLoader4Line,
  RiRefreshLine,
  RiSearchLine,
  RiSendPlane2Line,
  RiSettingsLine,
  RiTwitterXLine,
} from "@remixicon/react";
import { api } from "../../services/api";
import { onLocal } from "../host";
import { useViewStore } from "../../stores/view-store";
import type { PluginContext, ViewSlot } from "../types";
import type { AppSettings, XTweet } from "../../types";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { ConfirmDialog } from "../../components/ui/Dialog";
import {
  ViewContainer, SectionHeader, EmptyState, LoadingState, ErrorState, MetaText,
} from "../../components/ui/view";
import { cn } from "../../lib/cn";
import { ICON } from "../../lib/icons";
import { intlLocale } from "../../locales";
import {
  ConnectorHubHeader,
  ConnectorStatusPill,
  ConnectorToastBanner,
} from "../connector-ui";

export function createXHubView(_ctx: PluginContext): ViewSlot {
  return {
    kind: "view",
    id: "topmind-x.view.hub",
    order: 20,
    matches: (sel) => sel.kind === "connector" && sel.id === "x",
    render: () => <XHubView />,
  };
}

function XHubView() {
  const { t } = useTranslation("x");
  const openOverlay = useViewStore((s) => s.openOverlay);
  const select = useViewStore((s) => s.select);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [canRead, setCanRead] = useState(false);
  const [canPost, setCanPost] = useState(false);
  const [syncCategory, setSyncCategory] = useState("auto");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [fetching, setFetching] = useState(false);
  const [tweets, setTweets] = useState<XTweet[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sourceLabel, setSourceLabel] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [topicName, setTopicName] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [appendMode, setAppendMode] = useState(true);

  const [postText, setPostText] = useState("");
  const [confirmPost, setConfirmPost] = useState(false);
  const [posting, setPosting] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, st] = await Promise.all([
        api.sys.settings() as Promise<AppSettings>,
        api.x.status(),
      ]);
      setSettings(s);
      setCanRead(Boolean(st.canRead));
      setCanPost(Boolean(st.canPost));
      setSyncCategory(st.syncCategory || "auto");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const unsub = onLocal("x:open-prompt", (payload: unknown) => {
      const p = payload as { mode?: string; text?: string } | null;
      if (p?.mode === "post" && p.text) {
        setPostText([...p.text].slice(0, 280).join(""));
      }
    });
    return unsub;
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 6000);
  };

  const runFetch = async () => {
    const trimmed = query.trim();
    if (!trimmed || fetching) return;
    if (!canRead) {
      flash(t("hub.cannotReadError"));
      return;
    }
    setFetching(true);
    setTweets([]);
    setSelected(new Set());
    try {
      let list: XTweet[] = [];
      let label = trimmed;
      if (trimmed.startsWith("@")) {
        const username = trimmed.slice(1);
        const res = await api.x.timeline(username, 20);
        list = res.data || [];
        label = `@${username}`;
      } else {
        const res = await api.x.search(trimmed, 20);
        list = res.data || [];
        label = trimmed;
      }
      setTweets(list);
      setSourceLabel(label);
      setSelected(new Set(list.map((_, i) => i)));
      if (list.length === 0) flash(t("hub.noTweetsFound", { label }));
    } catch (e) {
      flash(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFetching(false);
    }
  };

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const archiveSelected = async () => {
    const picked = tweets.filter((_, i) => selected.has(i));
    if (picked.length === 0 || archiving) return;
    setArchiving(true);
    try {
      const safeSource = sourceLabel.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/gu, "_").slice(0, 40);
      const year = new Date().getFullYear();
      const topic =
        topicName.trim() ||
        `${year}-X-${safeSource || t("hub.defaultTopicName")}`;
      const title = noteTitle.trim() || `${sourceLabel || t("hub.defaultNoteTitle")} ${t("hub.fetch")}`;
      const res = await api.x.syncToNotes({
        tweets: picked,
        topicName: topic,
        title,
        append: appendMode,
      });
      const modeLabel = res.appended ? t("hub.appended") : t("hub.written");
      flash(t("hub.archiveToast", { mode: modeLabel, count: res.count ?? picked.length, path: res.path }));
      if (res.path) select({ kind: "file", path: res.path });
    } catch (e) {
      flash(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setArchiving(false);
    }
  };

  const doPost = async () => {
    const text = postText.trim();
    setConfirmPost(false);
    if (!text || posting) return;
    if ([...text].length > 280) {
      flash(t("hub.tooLongError"));
      return;
    }
    setPosting(true);
    try {
      const res = await api.x.post(text);
      flash(res.tweetId ? t("hub.postedToast", { id: res.tweetId }) : t("hub.postedOkToast"));
      setPostText("");
    } catch (e) {
      flash(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPosting(false);
    }
  };

  if (loading) return <LoadingState label={t("hub.loading")} />;
  if (error) return <ErrorState message={error} onRetry={() => void refresh()} />;

  if (!settings?.x?.enabled) {
    return (
      <ViewContainer>
        <EmptyState
          icon={<RiTwitterXLine size={ICON.md} />}
          title={t("hub.notEnabled")}
          hint={t("hub.notEnabledHint")}
          action={
            <Button size="sm" onClick={() => openOverlay("settings", { topicId: "topmind-x.settings" })}>
              <RiSettingsLine size={ICON.xs} /> {t("hub.openSettings")}
            </Button>
          }
        />
      </ViewContainer>
    );
  }

  const charCount = [...postText].length;

  return (
    <ViewContainer>
      <ConnectorHubHeader
        icon={<RiTwitterXLine size={ICON.md} />}
        title={t("hub.title")}
        subtitle={t("hub.subtitle")}
        meta={
          <>
            <ConnectorStatusPill ok={canRead} okLabel={t("hub.canRead")} badLabel={t("hub.cannotRead")} />
            <ConnectorStatusPill
              ok={canPost}
              okLabel={t("hub.canPost")}
              badLabel={t("hub.cannotPost")}
              badTone="muted"
            />
            <span>→ {syncCategory}/</span>
          </>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openOverlay("settings", { topicId: "topmind-x.settings" })}
          >
            <RiSettingsLine size={ICON.xs} aria-hidden /> {t("hub.settings")}
          </Button>
        }
      />

      <ConnectorToastBanner result={toast} />

      <section className="mb-6">
        <SectionHeader icon={<RiSearchLine size={ICON.sm} />} label={t("hub.fetchPreview")} />
        <div className="flex flex-wrap gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("hub.searchPlaceholder")}
            className="min-w-[200px] flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") void runFetch();
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!canRead || fetching || !query.trim()}
            onClick={() => void runFetch()}
          >
            {fetching ? <RiLoader4Line size={ICON.xs} className="animate-spin" /> : <RiRefreshLine size={ICON.xs} />}
            {t("hub.fetch")}
          </Button>
          <Button
            size="sm"
            disabled={selected.size === 0 || archiving}
            onClick={() => void archiveSelected()}
          >
            {archiving ? <RiLoader4Line size={ICON.xs} className="animate-spin" /> : null}
            {t("hub.archiveSelected", { count: selected.size })}
          </Button>
        </div>
        <p className="mt-1.5 text-3xs text-text-quaternary">
          {t("hub.fetchHint")}
        </p>

        {tweets.length > 0 ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-3xs text-text-tertiary">
              {t("hub.topicNameLabel")}
              <Input
                value={topicName}
                onChange={(e) => setTopicName(e.target.value)}
                placeholder={`${new Date().getFullYear()}-X-${sourceLabel || t("hub.defaultNoteTitle")}`}
                className="mt-1"
              />
            </label>
            <label className="block text-3xs text-text-tertiary">
              {t("hub.noteTitleLabel")}
              <Input
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder={`${sourceLabel || t("hub.defaultNoteTitle")} ${t("hub.fetch")}`}
                className="mt-1"
              />
            </label>
            <label className="flex items-center gap-2 text-3xs text-text-secondary sm:col-span-2">
              <input
                type="checkbox"
                checked={appendMode}
                onChange={(e) => setAppendMode(e.target.checked)}
                className="rounded border-border-subtle"
              />
              {t("hub.appendMode")}
            </label>
          </div>
        ) : null}

        {tweets.length > 0 ? (
          <div className="v4-dash-card mt-3 max-h-[360px] overflow-auto p-1">
            <div className="flex items-center justify-between px-2 py-1.5 text-3xs text-text-quaternary">
              <span>{t("hub.countLabel", { label: sourceLabel, count: tweets.length })}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="hover:text-accent-color"
                  onClick={() => setSelected(new Set(tweets.map((_, i) => i)))}
                >
                  {t("hub.selectAll")}
                </button>
                <button type="button" className="hover:text-accent-color" onClick={() => setSelected(new Set())}>
                  {t("hub.clear")}
                </button>
              </div>
            </div>
            {tweets.map((t, i) => {
              const on = selected.has(i);
              return (
                <button
                  key={t.id || i}
                  type="button"
                  onClick={() => toggle(i)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors",
                    on ? "bg-accent-bg-subtle" : "hover:bg-surface-muted",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-3xs",
                      on
                        ? "border-accent-color bg-accent-color text-white"
                        : "border-border-subtle text-transparent",
                    )}
                  >
                    ✓
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-3xs font-medium text-text-tertiary">
                      @{t.username}
                      {t.created_at ? (
                        <MetaText className="ml-1.5">
                          {new Date(t.created_at).toLocaleDateString(intlLocale())}
                        </MetaText>
                      ) : null}
                    </div>
                    <div className="mt-0.5 line-clamp-3 text-3xs text-text-secondary whitespace-pre-wrap">
                      {t.text}
                    </div>
                  </div>
                  <RiArrowRightSLine size={ICON.xs} className="mt-1 shrink-0 text-text-quaternary" />
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="mb-6">
        <SectionHeader icon={<RiSendPlane2Line size={ICON.sm} />} label={t("hub.composePost")} />
        {!canPost ? (
          <EmptyState
            icon={<RiSendPlane2Line size={ICON.md} />}
            title={t("hub.needXurl")}
            hint={t("hub.installHint")}
            action={
              <Button size="sm" variant="outline" onClick={() => openOverlay("settings", { topicId: "topmind-x.settings" })}>
                {t("hub.installGuide")}
              </Button>
            }
          />
        ) : (
          <div className="v4-dash-card space-y-2 p-3">
              <textarea
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              placeholder={t("hub.postPlaceholder")}
              rows={4}
              className="w-full resize-y rounded-[var(--radius-md)] border border-border-subtle-dim bg-surface px-2.5 py-2 text-3xs text-text-primary outline-none focus:border-accent-color"
            />
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "text-3xs tabular-nums",
                  charCount > 280 ? "text-error" : "text-text-quaternary",
                )}
              >
                {charCount}/280
              </span>
              <Button
                size="sm"
                disabled={!postText.trim() || charCount > 280 || posting}
                onClick={() => setConfirmPost(true)}
              >
                {posting ? <RiLoader4Line size={ICON.xs} className="animate-spin" /> : <RiSendPlane2Line size={ICON.xs} />}
                {t("hub.post")}
              </Button>
            </div>
          </div>
        )}
      </section>

      <Button variant="outline" size="sm" onClick={() => select({ kind: "stream" })}>
        {t("hub.backHome")}
      </Button>

      <ConfirmDialog
        open={confirmPost}
        title={t("hub.confirmPostTitle")}
        description={
          postText
            ? `「${postText.slice(0, 120)}${postText.length > 120 ? "…" : ""}」\n\n${t("hub.confirmPostDesc")}`
            : ""
        }
        confirmText={t("hub.post")}
        cancelText={t("hub.cancel")}
        onConfirm={() => void doPost()}
        onCancel={() => setConfirmPost(false)}
      />
    </ViewContainer>
  );
}
