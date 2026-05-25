import { ActivityIndicator, FlatList, RefreshControl, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { IssueRow } from "@/components/issue/issue-row";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { projectDetailOptions, projectIssuesOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function ProjectIssuesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { data: project } = useQuery(projectDetailOptions(wsId, id));
  const {
    data: issues = [],
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery(projectIssuesOptions(wsId, id));

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: project ? `${project.title} Issues` : "Project Issues" }} />
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="px-4 gap-3 pt-4">
          <Text className="text-sm text-destructive">
            Failed to load project issues:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : issues.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8 gap-2">
          <Text className="text-base font-medium text-foreground">
            No issues yet
          </Text>
          <Text className="text-sm text-muted-foreground text-center">
            New issues created from this project will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={issues}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View className="h-px bg-border ml-4" />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          renderItem={({ item }) => (
            <IssueRow
              issue={item}
              showStatus
              onPress={() => {
                if (wsSlug) router.push(`/${wsSlug}/issue/${item.id}`);
              }}
            />
          )}
        />
      )}
    </View>
  );
}
