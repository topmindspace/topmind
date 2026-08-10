/**
 * Shared topic picker dropdown content + hook (Inbox organize · Editor move).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2 } from "lucide-react";
import {
  DropdownItem,
  DropdownSectionLabel,
} from "../ui/DropdownMenu";
import { ICON } from "../../lib/icons";
import { getCachedTopicGroups } from "../../lib/workspace-data-cache";
import type { Topic } from "../../types";

export type TopicGroup = { category: string; topics: Topic[] };

export function TopicPickerList({
  groups,
  loading,
  busy,
  onPick,
  emptyHint,
}: {
  groups: TopicGroup[];
  loading: boolean;
  busy?: boolean;
  onPick: (topicId: string) => void;
  emptyHint?: string;
}) {
  const { t } = useTranslation(["workspace", "common"]);
  const flatCount = useMemo(() => groups.reduce((n, g) => n + g.topics.length, 0), [groups]);

  const defaultEmptyHint = emptyHint ?? t("workspace:topic.emptyHint");

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-3 text-3xs text-text-tertiary">
        <Loader2 size={ICON.xs} className="animate-spin" /> {t("common:action.loading")}
      </div>
    );
  }
  if (flatCount === 0) {
    return (
      <div className="px-2.5 py-3 text-3xs leading-relaxed text-text-quaternary">
        {defaultEmptyHint}
      </div>
    );
  }
  return (
    <>
      {groups.map((g) => (
        <div key={g.category} className="mb-1 last:mb-0">
          <DropdownSectionLabel>{g.category}</DropdownSectionLabel>
          {g.topics.map((t) => (
            <DropdownItem key={t.id} disabled={busy} onSelect={() => onPick(t.id)}>
              <FolderOpen size={ICON.xs} className="shrink-0 text-text-quaternary" />
              <span className="min-w-0 truncate">{t.name}</span>
            </DropdownItem>
          ))}
        </div>
      ))}
    </>
  );
}

export function useTopicGroups(open: boolean) {
  const [groups, setGroups] = useState<TopicGroup[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void getCachedTopicGroups(false)
      .then((g) => {
        if (!cancelled) setGroups(g as TopicGroup[]);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return { groups, loading };
}
