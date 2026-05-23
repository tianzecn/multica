"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Hash, Lock, Plus, RotateCcw, Search, X } from "lucide-react";
import { channelGroupsOptions, channelListOptions, useArchiveChannel, useCreateChannel, useRestoreChannel } from "@multica/core/channels";
import { useCurrentMember } from "@multica/core/permissions";
import { useCurrentWorkspace, useWorkspacePaths } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Agent, Channel, ChannelGroup, ChannelVisibility } from "@multica/core/types";
import { Badge } from "@multica/ui/components/ui/badge";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@multica/ui/components/ui/radio-group";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Switch } from "@multica/ui/components/ui/switch";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { cn } from "@multica/ui/lib/utils";
import { AppLink, useNavigation } from "../navigation";
import { PageHeader } from "../layout/page-header";
import { useT } from "../i18n";
import { ActorAvatar } from "../common/actor-avatar";
import { toast } from "sonner";

const EMPTY_CHANNELS: Channel[] = [];
const EMPTY_GROUPS: ChannelGroup[] = [];

export function ChannelsPage() {
  const { t } = useT("channels");
  const workspace = useCurrentWorkspace();
  const wsId = workspace?.id ?? "";
  const p = useWorkspacePaths();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const { data: activeChannels = EMPTY_CHANNELS, isLoading: activeLoading } = useQuery({
    ...channelListOptions(wsId),
    enabled: !!wsId,
  });
  const { data: channelsWithArchived = EMPTY_CHANNELS, isLoading: archivedLoading } = useQuery({
    ...channelListOptions(wsId, { includeArchived: true }),
    enabled: !!wsId && showArchived,
  });
  const { data: groups = EMPTY_GROUPS } = useQuery({
    ...channelGroupsOptions(wsId),
    enabled: !!wsId,
  });
  const { userId, role } = useCurrentMember(wsId);
  const canArchiveWorkspaceChannels = role === "owner" || role === "admin";
  const archivedChannels = useMemo(
    () => channelsWithArchived.filter((channel) => channel.archived_at),
    [channelsWithArchived],
  );
  const channels = showArchived ? archivedChannels : activeChannels;
  const isLoading = activeLoading || (showArchived && archivedLoading);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((channel) =>
      [channel.name, channel.slug, channel.description].some((value) => value.toLowerCase().includes(q)),
    );
  }, [channels, search]);

  const grouped = useMemo(() => groupChannels(filtered, groups), [filtered, groups]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader className="justify-between px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Hash className="size-4 text-muted-foreground" />
          <h1 className="truncate text-sm font-medium">{t(($) => $.page.title)}</h1>
          {!isLoading && channels.length > 0 && (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{channels.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={showArchived ? "secondary" : "outline"} onClick={() => setShowArchived((value) => !value)}>
            <Archive className="mr-1.5 size-3.5" />
            已归档
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 size-3.5" />
            {t(($) => $.page.new_button)}
          </Button>
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center border-b px-4">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t(($) => $.page.search_placeholder)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        {isLoading ? (
          <ChannelsSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Hash className="size-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {channels.length === 0 && showArchived ? "还没有归档频道" : channels.length === 0 ? t(($) => $.page.empty) : t(($) => $.page.empty_search)}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid gap-5">
              {grouped.map((group) => (
                <section key={group.key} className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <h2 className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{group.name}</h2>
                    <span className="font-mono text-[11px] text-muted-foreground/70">{group.channels.length}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {group.channels.map((channel) => (
                      <ChannelTile
                        key={channel.id}
                        channel={channel}
                        href={p.channelDetail(channel.slug)}
                        canArchive={canArchiveWorkspaceChannels || channel.created_by === userId}
                        isArchived={!!channel.archived_at}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      <CreateChannelDialog open={showCreate} onOpenChange={setShowCreate} groups={groups} wsId={wsId} />
    </div>
  );
}

function groupChannels(channels: Channel[], groups: ChannelGroup[]) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const buckets = new Map<string, { key: string; name: string; channels: Channel[] }>();
  for (const channel of channels) {
    const group = channel.group_id ? groupById.get(channel.group_id) : null;
    const key = group?.id ?? "ungrouped";
    const name = group?.name ?? "Channels";
    if (!buckets.has(key)) buckets.set(key, { key, name, channels: [] });
    buckets.get(key)?.channels.push(channel);
  }
  return Array.from(buckets.values());
}

function ChannelTile({
  channel,
  href,
  canArchive,
  isArchived,
}: {
  channel: Channel;
  href: string;
  canArchive: boolean;
  isArchived: boolean;
}) {
  const archiveChannel = useArchiveChannel(channel.id);
  const restoreChannel = useRestoreChannel(channel.id);
  const submitVisibilityChange = () => {
    if (isArchived) {
      restoreChannel.mutate(undefined, {
        onSuccess: () => toast.success("频道已恢复"),
        onError: (error) => toast.error(error instanceof Error ? error.message : "恢复频道失败"),
      });
      return;
    }
    if (!window.confirm(`归档频道「${channel.name}」？归档后默认列表会隐藏它，历史消息不会删除。`)) return;
    archiveChannel.mutate(undefined, {
      onSuccess: () => toast.success("频道已归档"),
      onError: (error) => toast.error(error instanceof Error ? error.message : "归档频道失败"),
    });
  };
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-2">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {channel.visibility === "private" ? <Lock className="size-3.5" /> : <Hash className="size-3.5" />}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium">{channel.name}</p>
            {isArchived && <Badge variant="outline" className="h-5 shrink-0 rounded-[4px] px-1.5 text-[10px]">已归档</Badge>}
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">#{channel.slug}</p>
        </div>
      </div>
      {channel.description && (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{channel.description}</p>
      )}
    </>
  );

  return (
    <div className="group/channel relative min-h-24 min-w-0 rounded-lg border bg-background transition-colors hover:bg-accent/50">
      {isArchived ? (
        <div className="flex min-h-24 min-w-0 flex-col justify-between p-3 pr-10">{content}</div>
      ) : (
        <AppLink href={href} className="flex min-h-24 min-w-0 flex-col justify-between p-3 pr-10">
          {content}
        </AppLink>
      )}
      {canArchive && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="absolute right-2 top-2 size-7 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/channel:opacity-100 focus:opacity-100"
          onClick={submitVisibilityChange}
          disabled={archiveChannel.isPending || restoreChannel.isPending}
          title={isArchived ? "恢复频道" : "归档频道"}
          aria-label={`${isArchived ? "恢复" : "归档"}频道 ${channel.name}`}
        >
          {isArchived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}
        </Button>
      )}
    </div>
  );
}

function CreateChannelDialog({
  open,
  onOpenChange,
  groups,
  wsId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ChannelGroup[];
  wsId: string;
}) {
  const { t } = useT("channels");
  const createChannel = useCreateChannel();
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const { data: agents = [] } = useQuery({
    ...agentListOptions(wsId),
    enabled: !!wsId && open,
  });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [visibility, setVisibility] = useState<ChannelVisibility>("private");
  const [mentionIssueSearchEnabled, setMentionIssueSearchEnabled] = useState(true);
  const [groupId, setGroupId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  const activeAgents = useMemo(() => agents.filter((agent) => !agent.archived_at), [agents]);
  const selectedAgentSet = useMemo(() => new Set(selectedAgentIds), [selectedAgentIds]);
  const selectedAgents = useMemo(
    () => selectedAgentIds.map((id) => activeAgents.find((agent) => agent.id === id)).filter(Boolean) as Agent[],
    [activeAgents, selectedAgentIds],
  );
  const filteredAgents = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return activeAgents;
    return activeAgents.filter((agent) =>
      [agent.name, agent.description].some((value) => value.toLowerCase().includes(q)),
    );
  }, [activeAgents, memberSearch]);

  useEffect(() => {
    if (!open || selectedAgentIds.length > 0 || activeAgents.length === 0) return;
    setSelectedAgentIds(activeAgents.slice(0, 2).map((agent) => agent.id));
  }, [activeAgents, open, selectedAgentIds.length]);

  const canSubmit = name.trim().length > 0 && !createChannel.isPending;
  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId],
    );
  };

  const submit = () => {
    if (!canSubmit) return;
    createChannel.mutate(
      {
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim(),
        instructions: instructions.trim(),
        visibility,
        mention_issue_search_enabled: mentionIssueSearchEnabled,
        group_id: groupId || null,
        members: selectedAgentIds.map((id) => ({
          member_type: "agent",
          member_id: id,
          role: "member",
        })),
      },
      {
        onSuccess: (channel) => {
          setName("");
          setSlug("");
          setDescription("");
          setInstructions("");
          setVisibility("private");
          setMentionIssueSearchEnabled(true);
          setGroupId("");
          setMemberSearch("");
          setSelectedAgentIds([]);
          onOpenChange(false);
          toast.success(t(($) => $.toast.created));
          navigation.push(paths.channelDetail(channel.slug));
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : t(($) => $.toast.create_failed));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t(($) => $.create.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.create.description)}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[72vh] gap-4 overflow-y-auto py-2 pr-1">
          <div className="grid gap-2">
            <Label htmlFor="channel-name">{t(($) => $.create.name_label)}</Label>
            <Input id="channel-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="channel-slug">{t(($) => $.create.slug_label)}</Label>
            <Input
              id="channel-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder={t(($) => $.create.slug_placeholder)}
              className="font-mono"
            />
          </div>
          {groups.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="channel-group">{t(($) => $.create.group_label)}</Label>
              <select
                id="channel-group"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">{t(($) => $.create.group_none)}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="channel-description">{t(($) => $.create.description_label)}</Label>
            <Textarea
              id="channel-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-20"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="channel-instructions">{t(($) => $.create.instructions_label)}</Label>
            <Textarea
              id="channel-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              className="min-h-20"
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0">
              <Label htmlFor="channel-issue-mention-search">Issue @ 补全</Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                输入 @ 时允许搜索并插入 Issue。讨论型频道可以关闭它，让 @ 只显示频道成员。
              </p>
            </div>
            <Switch
              id="channel-issue-mention-search"
              checked={mentionIssueSearchEnabled}
              onCheckedChange={setMentionIssueSearchEnabled}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label>AI 同事</Label>
              <span className="text-xs text-muted-foreground">已选择 {selectedAgentIds.length} 位</span>
            </div>
            <div className="grid min-h-72 overflow-hidden rounded-md border md:grid-cols-[minmax(0,1fr)_260px]">
              <div className="flex min-h-0 flex-col border-b md:border-b-0 md:border-r">
                <div className="border-b p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={memberSearch}
                      onChange={(event) => setMemberSearch(event.target.value)}
                      placeholder="搜索工作区智能体"
                      className="h-8 pl-8 text-sm"
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto p-1">
                  {filteredAgents.length === 0 ? (
                    <p className="px-3 py-8 text-center text-xs text-muted-foreground">没有可加入的智能体</p>
                  ) : (
                    filteredAgents.map((agent) => {
                      const checked = selectedAgentSet.has(agent.id);
                      return (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => toggleAgent(agent.id)}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent/70",
                            checked && "bg-accent",
                          )}
                        >
                          <span onClick={(event) => event.stopPropagation()}>
                            <Checkbox checked={checked} onCheckedChange={() => toggleAgent(agent.id)} />
                          </span>
                          <ActorAvatar actorType="agent" actorId={agent.id} size={28} showStatusDot />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium">{agent.name}</span>
                              <Badge variant="outline" className="h-4 rounded-[4px] px-1 text-[10px]">AI</Badge>
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{agent.description || agent.id}</span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <div className="flex min-h-0 flex-col bg-muted/20">
                <div className="border-b px-3 py-2">
                  <p className="text-xs font-medium">已选成员</p>
                  <p className="mt-1 text-xs text-muted-foreground">频道创建者会自动包含在内。</p>
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  {selectedAgents.length === 0 ? (
                    <p className="px-1 py-8 text-center text-xs text-muted-foreground">还没有选择 AI 同事</p>
                  ) : (
                    <div className="grid gap-1.5">
                      {selectedAgents.map((agent) => (
                        <div key={agent.id} className="flex min-w-0 items-center gap-2 rounded-md bg-background px-2 py-2">
                          <ActorAvatar actorType="agent" actorId={agent.id} size={24} showStatusDot />
                          <span className="min-w-0 flex-1 truncate text-sm">{agent.name}</span>
                          <Badge variant="outline" className="h-4 rounded-[4px] px-1 text-[10px]">AI</Badge>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="size-6 shrink-0"
                            onClick={() => toggleAgent(agent.id)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <RadioGroup value={visibility} onValueChange={(value) => setVisibility(value as ChannelVisibility)} className="grid grid-cols-2 gap-2">
            {(["private", "public"] as const).map((value) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
                  visibility === value && "border-primary bg-accent/50",
                )}
              >
                <RadioGroupItem value={value} className="mt-0.5" />
                <span>
                  <span className="block font-medium">{t(($) => $.create.visibility[value].label)}</span>
                  <span className="block text-xs leading-5 text-muted-foreground">{t(($) => $.create.visibility[value].description)}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t(($) => $.create.cancel)}</Button>
          <Button onClick={submit} disabled={!canSubmit}>{t(($) => $.create.submit)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChannelsSkeleton() {
  return (
    <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="rounded-lg border p-3">
          <Skeleton className="mb-3 h-7 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}
