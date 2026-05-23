import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type {
  ApprovalRequest,
  ChannelDispatchPlan,
  ChannelMessage,
  ChannelSession,
} from "@multica/core/types";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import {
  channelApprovalsOptions,
  channelDetailOptions,
  channelDispatchPlansOptions,
  channelIssuesOptions,
  channelMessagesOptions,
  channelSessionsOptions,
} from "@/data/queries/channels";
import {
  useCreateChannelMessage,
  useCreateChannelSession,
  useCancelChannelDispatchPlan,
  useLinkIssueToChannel,
  useRetryChannelDispatchStep,
  useResolveChannelApproval,
  useSkipChannelDispatchStep,
} from "@/data/mutations/channels";
import { useWorkspaceStore } from "@/data/workspace-store";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

export default function ChannelDetailScreen() {
  const { id } = useLocalSearchParams<{ workspace: string; id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { colorScheme } = useColorScheme();
  const iconColor = THEME[colorScheme].mutedForeground;

  const channelRef = id ?? "";
  const { data: channel, isLoading: channelLoading } = useQuery(
    channelDetailOptions(wsId, channelRef),
  );
  const channelId = channel?.id || channelRef;

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery(
    channelSessionsOptions(wsId, channelId),
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (activeSessionId) {
      if (sessions.some((session) => session.id === activeSessionId)) return;
    }
    setActiveSessionId(sessions[0]?.id ?? null);
  }, [activeSessionId, sessions]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const { data: messages = [], isLoading: messagesLoading } = useQuery(
    channelMessagesOptions(wsId, channelId, activeSessionId),
  );
  const { data: dispatchPlans = [] } = useQuery(
    channelDispatchPlansOptions(wsId, channelId, activeSessionId),
  );
  const { data: issues = [] } = useQuery(
    channelIssuesOptions(wsId, channelId),
  );
  const { data: approvals = [] } = useQuery(
    channelApprovalsOptions(wsId, channelId),
  );

  const createSession = useCreateChannelSession(channelId);
  const createMessage = useCreateChannelMessage(channelId, activeSessionId);
  const linkIssue = useLinkIssueToChannel(channelId);
  const approve = useResolveChannelApproval(channelId, "approved");
  const reject = useResolveChannelApproval(channelId, "rejected");
  const cancelPlan = useCancelChannelDispatchPlan(channelId, activeSessionId);
  const retryStep = useRetryChannelDispatchStep(channelId, activeSessionId);
  const skipStep = useSkipChannelDispatchStep(channelId, activeSessionId);
  const [draft, setDraft] = useState("");

  const createSessionWithTitle = useCallback(
    async (rawTitle: string) => {
      const title = rawTitle.trim();
      if (!title) return;
      try {
        const session = await createSession.mutateAsync({ title });
        setActiveSessionId(session.id);
      } catch (err) {
        Alert.alert(
          "Could not create session",
          err instanceof Error ? err.message : "Please try again.",
        );
      }
    },
    [createSession],
  );

  const askForSessionTitle = () => {
    const fallbackTitle = `Session ${sessions.length + 1}`;
    if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
      Alert.prompt(
        "New session",
        "Split each topic into its own focused context.",
        (value) => void createSessionWithTitle(value || fallbackTitle),
        "plain-text",
        fallbackTitle,
      );
      return;
    }
    void createSessionWithTitle(fallbackTitle);
  };

  const askForIssue = () => {
    if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
      Alert.prompt(
        "Link issue",
        "Paste an issue id or workspace issue key.",
        (value) => {
          const issueId = value.trim();
          if (!issueId) return;
          linkIssue.mutate({
            issue_id: issueId,
            session_id: activeSessionId,
          });
        },
      );
    }
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || !activeSessionId) return;
    try {
      setDraft("");
      await createMessage.mutateAsync({ content });
    } catch (err) {
      setDraft(content);
      Alert.alert(
        "Message failed",
        err instanceof Error ? err.message : "Please try again.",
      );
    }
  };

  if (channelLoading || sessionsLoading) {
    return <ChannelDetailLoading />;
  }

  if (!channel || !channel.id) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-8 gap-3">
        <Ionicons name="alert-circle-outline" size={42} color={iconColor} />
        <Text className="text-base font-medium text-foreground text-center">
          Channel not found
        </Text>
        <Button variant="outline" onPress={() => router.back()}>
          <Text>Back</Text>
        </Button>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <View className="border-b border-border bg-background">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-4 py-3 gap-2"
        >
          <SessionCreateButton
            onPress={askForSessionTitle}
            disabled={createSession.isPending}
          />
          {sessions.map((session) => (
            <SessionChip
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              onPress={() => setActiveSessionId(session.id)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <ChannelContext
            name={channel.name}
            slug={channel.slug}
            visibility={channel.visibility}
            description={channel.description}
            instructions={channel.instructions}
            activeSession={activeSession}
            issueCount={issues.length}
            approvalCount={approvals.filter((item) => item.status === "pending").length}
            onLinkIssue={askForIssue}
            canLinkIssue={Platform.OS === "ios"}
          />
        }
        ListEmptyComponent={
          messagesLoading ? (
            <MessageLoading />
          ) : activeSession ? (
            <View className="px-4 py-8 items-center gap-2">
              <Ionicons
                name="chatbox-ellipses-outline"
                size={36}
                color={iconColor}
              />
              <Text className="text-sm font-medium text-foreground">
                Start this session
              </Text>
              <Text className="text-xs text-muted-foreground text-center">
                AI teammates will read this session context, not the whole
                channel history.
              </Text>
            </View>
          ) : (
            <View className="px-4 py-8 items-center gap-3">
              <Ionicons name="albums-outline" size={36} color={iconColor} />
              <Text className="text-sm font-medium text-foreground">
                Create a session
              </Text>
              <Text className="text-xs text-muted-foreground text-center">
                Sessions keep topics focused and prevent context overflow.
              </Text>
              <Button size="sm" onPress={askForSessionTitle}>
                <Text>New session</Text>
              </Button>
            </View>
          )
        }
        ListFooterComponent={
          <ChannelSideSections
            approvals={approvals}
            approving={approve.isPending}
            rejecting={reject.isPending}
            onApprove={(item) =>
              approve.mutate({
                approvalId: item.id,
                resolution_note: "Approved from mobile.",
              })
            }
            onReject={(item) =>
              reject.mutate({
                approvalId: item.id,
                resolution_note: "Rejected from mobile.",
              })
            }
          />
        }
        contentContainerClassName="pb-4"
        renderItem={({ item }) => (
          <View>
            <MessageBubble message={item} />
            {dispatchPlans
              .filter((plan) => plan.trigger_message_id === item.id)
              .map((plan) => (
                <DispatchPlanCard
                  key={plan.id}
                  plan={plan}
                  cancelling={cancelPlan.isPending}
                  retrying={retryStep.isPending}
                  skipping={skipStep.isPending}
                  onCancel={() => cancelPlan.mutate(plan.id)}
                  onRetry={(stepId) =>
                    retryStep.mutate({ planId: plan.id, stepId })
                  }
                  onSkip={(stepId) =>
                    skipStep.mutate({
                      planId: plan.id,
                      stepId,
                      reason: "Skipped from mobile.",
                    })
                  }
                />
              ))}
          </View>
        )}
      />

      <View className="border-t border-border bg-background px-3 py-2 gap-2">
        <View className="flex-row items-end gap-2">
          <View className="flex-1 rounded-md bg-secondary/50 px-3 py-2">
            <AutosizeTextArea
              value={draft}
              onChangeText={setDraft}
              editable={!!activeSessionId && !createMessage.isPending}
              placeholder={
                activeSessionId
                  ? "Message this session"
                  : "Create a session first"
              }
              minHeight={36}
              maxHeight={120}
              className="text-sm"
            />
          </View>
          <IconButton
            name="send"
            disabled={!draft.trim() || !activeSessionId || createMessage.isPending}
            onPress={sendMessage}
            accessibilityLabel="Send channel message"
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function ChannelContext({
  name,
  slug,
  visibility,
  description,
  instructions,
  activeSession,
  issueCount,
  approvalCount,
  onLinkIssue,
  canLinkIssue,
}: {
  name: string;
  slug: string;
  visibility: string;
  description: string;
  instructions: string;
  activeSession: ChannelSession | null;
  issueCount: number;
  approvalCount: number;
  onLinkIssue: () => void;
  canLinkIssue: boolean;
}) {
  return (
    <View className="p-4 gap-3">
      <Card className="gap-3">
        <View className="flex-row items-start gap-3">
          <View className="size-10 rounded-md bg-secondary items-center justify-center">
            <Ionicons
              name={visibility === "private" ? "lock-closed-outline" : "chatbubbles-outline"}
              size={18}
              color="#71717a"
            />
          </View>
          <View className="flex-1 min-w-0">
            <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>
              {name}
            </Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              #{slug} - {visibility}
            </Text>
          </View>
        </View>
        {description ? (
          <Text className="text-sm text-muted-foreground">{description}</Text>
        ) : null}
        {instructions ? (
          <View className="rounded-md bg-secondary/50 p-3 gap-1">
            <Text className="text-xs font-medium text-foreground">
              Instructions
            </Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={4}>
              {instructions}
            </Text>
          </View>
        ) : null}
        <View className="flex-row gap-2">
          <Badge label={`${issueCount} issues`} />
          <Badge label={`${approvalCount} approvals`} />
          {activeSession ? <Badge label={activeSession.status} /> : null}
        </View>
        <Button
          size="sm"
          variant="outline"
          onPress={onLinkIssue}
          disabled={!canLinkIssue}
        >
          <Text>Link issue</Text>
        </Button>
      </Card>
    </View>
  );
}

function SessionCreateButton({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onPress={onPress}
      disabled={disabled}
      className="rounded-full"
    >
      <Ionicons name="add" size={14} color="#71717a" />
      <Text>Session</Text>
    </Button>
  );
}

function SessionChip({
  session,
  active,
  onPress,
}: {
  session: ChannelSession;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "h-9 max-w-56 rounded-full border px-3 flex-row items-center",
        active ? "border-primary bg-primary/10" : "border-border bg-card",
      )}
    >
      <Text className="text-sm text-foreground" numberOfLines={1}>
        {session.title}
      </Text>
    </Pressable>
  );
}

function MessageBubble({ message }: { message: ChannelMessage }) {
  const isUser = message.author_type === "member";
  return (
    <View className={cn("px-4 py-1.5", isUser && "items-end")}>
      <View
        className={cn(
          "max-w-[82%] rounded-md px-3 py-2",
          isUser ? "bg-primary" : "bg-secondary",
        )}
      >
        <Text
          className={cn(
            "text-sm",
            isUser ? "text-primary-foreground" : "text-secondary-foreground",
          )}
        >
          {message.content}
        </Text>
      </View>
    </View>
  );
}

function DispatchPlanCard({
  plan,
  cancelling,
  retrying,
  skipping,
  onCancel,
  onRetry,
  onSkip,
}: {
  plan: ChannelDispatchPlan;
  cancelling: boolean;
  retrying: boolean;
  skipping: boolean;
  onCancel: () => void;
  onRetry: (stepId: string) => void;
  onSkip: (stepId: string) => void;
}) {
  const active = ["queued", "running", "paused"].includes(plan.status);
  return (
    <View className="px-4 py-1.5">
      <Card className="gap-3 border-dashed">
        <View className="flex-row items-center gap-2">
          <Ionicons name="git-branch-outline" size={16} color="#64748b" />
          <Text className="flex-1 text-sm font-semibold text-foreground">
            Dispatch plan
          </Text>
          <Text className="text-xs text-muted-foreground">{plan.mode}</Text>
          <Text className="text-xs text-muted-foreground">{plan.status}</Text>
        </View>
        <Text className="text-xs text-muted-foreground" numberOfLines={2}>
          {Math.round(plan.confidence * 100)}% · {plan.reason}
        </Text>
        <View className="gap-2">
          {plan.steps.map((step) => {
            const status = step.task_status || step.status;
            const canRetry = ["failed", "skipped", "cancelled"].includes(status);
            const canSkip = ["pending", "queued"].includes(step.status);
            return (
              <View key={step.id} className="rounded-md bg-secondary/40 p-2 gap-2">
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1 text-xs font-medium text-foreground" numberOfLines={1}>
                    {step.role === "summarizer" ? "Summary" : "AI"} · {step.agent_id.slice(0, 8)}
                  </Text>
                  <Text className="text-xs text-muted-foreground">{status}</Text>
                </View>
                {(canRetry || canSkip) && (
                  <View className="flex-row gap-2">
                    {canRetry && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retrying}
                        onPress={() => onRetry(step.id)}
                      >
                        <Text>Retry</Text>
                      </Button>
                    )}
                    {canSkip && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={skipping}
                        onPress={() => onSkip(step.id)}
                      >
                        <Text>Skip</Text>
                      </Button>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
        {active && (
          <Button variant="outline" disabled={cancelling} onPress={onCancel}>
            <Text>Cancel plan</Text>
          </Button>
        )}
      </Card>
    </View>
  );
}

function ChannelSideSections({
  approvals,
  approving,
  rejecting,
  onApprove,
  onReject,
}: {
  approvals: ApprovalRequest[];
  approving: boolean;
  rejecting: boolean;
  onApprove: (item: ApprovalRequest) => void;
  onReject: (item: ApprovalRequest) => void;
}) {
  const pendingApprovals = approvals.filter((item) => item.status === "pending");
  if (pendingApprovals.length === 0) return null;

  return (
    <View className="px-4 pt-3 gap-3">
      <Text className="text-xs font-medium uppercase text-muted-foreground">
        Pending approvals
      </Text>
      {pendingApprovals.map((approval) => (
        <Card key={approval.id} className="gap-3">
          <View className="gap-1">
            <Text className="text-sm font-semibold text-foreground">
              {approval.action_type}
            </Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={3}>
              {JSON.stringify(approval.action_payload)}
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Button
              size="sm"
              className="flex-1"
              disabled={approving || rejecting}
              onPress={() => onApprove(approval)}
            >
              <Text>Approve</Text>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={approving || rejecting}
              onPress={() => onReject(approval)}
            >
              <Text>Reject</Text>
            </Button>
          </View>
        </Card>
      ))}
    </View>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View className="rounded-full bg-secondary px-2.5 py-1">
      <Text className="text-xs text-secondary-foreground">{label}</Text>
    </View>
  );
}

function MessageLoading() {
  return (
    <View className="px-4 py-3 gap-3">
      <Skeleton className="h-10 w-3/4 rounded-md" />
      <Skeleton className="h-10 w-2/3 rounded-md self-end" />
      <Skeleton className="h-10 w-4/5 rounded-md" />
    </View>
  );
}

function ChannelDetailLoading() {
  return (
    <View className="flex-1 bg-background px-4 pt-4 gap-4">
      <Skeleton className="h-9 w-40 rounded-full" />
      <View className="rounded-md border border-border bg-card p-4 gap-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-16 w-full" />
      </View>
    </View>
  );
}
