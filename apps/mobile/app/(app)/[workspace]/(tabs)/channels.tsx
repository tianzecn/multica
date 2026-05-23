import { useMemo } from "react";
import { FlatList, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { Channel } from "@multica/core/types";
import { Button } from "@/components/ui/button";
import { CardPressable } from "@/components/ui/card";
import { Header } from "@/components/ui/header";
import { HeaderActions } from "@/components/ui/app-header-actions";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { channelListOptions } from "@/data/queries/channels";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

export default function ChannelsTab() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const iconColor = THEME[colorScheme].mutedForeground;

  const { data: workspaces } = useQuery(workspaceListOptions());
  const currentWorkspace = workspaces?.find((w) => w.id === wsId);
  const channelsEnabled =
    currentWorkspace?.settings?.channels_enabled === true;

  const {
    data: channels = [],
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery(channelListOptions(wsId));

  const sortedChannels = useMemo(
    () =>
      [...channels].sort((a, b) => {
        if (a.group_id !== b.group_id) {
          return (a.group_id ?? "").localeCompare(b.group_id ?? "");
        }
        if (a.position !== b.position) return a.position - b.position;
        return a.name.localeCompare(b.name);
      }),
    [channels],
  );

  const openChannel = (channel: Channel) => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/channel/[id]",
      params: { workspace: wsSlug, id: channel.slug || channel.id },
    });
  };

  const createChannel = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/channel/new",
      params: { workspace: wsSlug },
    });
  };

  return (
    <View className="flex-1 bg-background">
      <Header
        title="Channels"
        subtitle="Shared rooms for agent collaboration"
        right={
          <>
            <IconButton
              name="add"
              onPress={createChannel}
              accessibilityLabel="New channel"
            />
            <HeaderActions />
          </>
        }
      />

      {!channelsEnabled ? (
        <View className="flex-1 items-center justify-center px-8 gap-3">
          <Ionicons name="lock-closed-outline" size={42} color={iconColor} />
          <Text className="text-base font-medium text-foreground text-center">
            Channels are disabled
          </Text>
          <Text className="text-sm text-muted-foreground text-center">
            Enable the hidden channels flag for this workspace to use shared
            channel sessions.
          </Text>
        </View>
      ) : isLoading ? (
        <ChannelsLoading />
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            Failed to load channels:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : sortedChannels.length === 0 ? (
        <ChannelsEmpty iconColor={iconColor} onCreate={createChannel} />
      ) : (
        <FlatList
          data={sortedChannels}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4 gap-3 pb-8"
          refreshing={isRefetching}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <CardPressable
              onPress={() => openChannel(item)}
              accessibilityLabel={`Open ${item.name}`}
              className="gap-2"
            >
              <View className="flex-row items-start gap-3">
                <View className="size-9 rounded-md bg-secondary items-center justify-center">
                  <Ionicons
                    name={
                      item.visibility === "private"
                        ? "lock-closed-outline"
                        : "chatbubbles-outline"
                    }
                    size={18}
                    color={iconColor}
                  />
                </View>
                <View className="flex-1 min-w-0">
                  <Text
                    className="text-base font-semibold text-foreground"
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                  >
                    #{item.slug} - {item.visibility}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={iconColor}
                />
              </View>
              {item.description ? (
                <Text className="text-sm text-muted-foreground" numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
            </CardPressable>
          )}
        />
      )}
    </View>
  );
}

function ChannelsLoading() {
  return (
    <View className="px-4 pt-4 gap-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <View
          key={index}
          className="rounded-md border border-border bg-card p-4 gap-3"
        >
          <View className="flex-row gap-3">
            <Skeleton className="size-9 rounded-md" />
            <View className="flex-1 gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </View>
          </View>
          <Skeleton className="h-3 w-full" />
        </View>
      ))}
    </View>
  );
}

function ChannelsEmpty({
  iconColor,
  onCreate,
}: {
  iconColor: string;
  onCreate: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8 gap-3">
      <Ionicons name="chatbubbles-outline" size={42} color={iconColor} />
      <Text className="text-base font-medium text-foreground text-center">
        No channels yet
      </Text>
      <Text className="text-sm text-muted-foreground text-center">
        Create a shared room, then split the work into focused sessions.
      </Text>
      <Button onPress={onCreate} className="mt-1">
        <Text>New channel</Text>
      </Button>
    </View>
  );
}
