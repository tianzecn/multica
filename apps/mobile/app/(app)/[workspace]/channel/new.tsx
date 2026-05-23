import { useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { ChannelVisibility } from "@multica/core/types";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useCreateChannel } from "@/data/mutations/channels";
import { cn } from "@/lib/utils";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export default function NewChannelScreen() {
  const { workspace } = useLocalSearchParams<{ workspace: string }>();
  const createChannel = useCreateChannel();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [visibility, setVisibility] = useState<ChannelVisibility>("private");

  const normalizedSlug = useMemo(
    () => slugify(slug || name),
    [name, slug],
  );
  const canSubmit = name.trim().length > 0 && normalizedSlug.length > 0;

  const updateName = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const submit = async () => {
    if (!canSubmit) return;
    try {
      const channel = await createChannel.mutateAsync({
        name: name.trim(),
        slug: normalizedSlug,
        description: description.trim(),
        instructions: instructions.trim(),
        visibility,
      });
      router.replace({
        pathname: "/[workspace]/channel/[id]",
        params: {
          workspace,
          id: channel.slug || channel.id,
        },
      });
    } catch (err) {
      Alert.alert(
        "Could not create channel",
        err instanceof Error ? err.message : "Please try again.",
      );
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="p-4 gap-4 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <Card className="gap-4">
          <Field label="Name">
            <TextField
              value={name}
              onChangeText={updateName}
              placeholder="Design review"
              autoCapitalize="words"
              returnKeyType="next"
            />
          </Field>

          <Field label="Slug">
            <TextField
              value={slug}
              onChangeText={(value) => {
                setSlugTouched(true);
                setSlug(slugify(value));
              }}
              placeholder="design-review"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text className="text-xs text-muted-foreground">
              Lowercase letters, numbers, dashes, and underscores.
            </Text>
          </Field>

          <Field label="Description">
            <AutosizeTextArea
              value={description}
              onChangeText={setDescription}
              placeholder="What should this channel be used for?"
              className="rounded-md border border-transparent bg-secondary/50 px-3 py-2 text-sm"
              minHeight={80}
              maxHeight={140}
            />
          </Field>

          <Field label="Instructions">
            <AutosizeTextArea
              value={instructions}
              onChangeText={setInstructions}
              placeholder="Context and operating rules for the AI teammates."
              className="rounded-md border border-transparent bg-secondary/50 px-3 py-2 text-sm"
              minHeight={96}
              maxHeight={180}
            />
          </Field>
        </Card>

        <Card className="gap-3">
          <Text className="text-sm font-medium text-foreground">
            Visibility
          </Text>
          <View className="flex-row gap-2">
            <VisibilityButton
              active={visibility === "private"}
              title="Private"
              description="Only invited members can see it."
              onPress={() => setVisibility("private")}
            />
            <VisibilityButton
              active={visibility === "public"}
              title="Public"
              description="Anyone in the workspace can join."
              onPress={() => setVisibility("public")}
            />
          </View>
        </Card>

        <Button
          onPress={submit}
          disabled={!canSubmit || createChannel.isPending}
        >
          <Text>{createChannel.isPending ? "Creating..." : "Create"}</Text>
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      {children}
    </View>
  );
}

function VisibilityButton({
  active,
  title,
  description,
  onPress,
}: {
  active: boolean;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Button
      variant="outline"
      onPress={onPress}
      className={cn(
        "h-auto flex-1 items-start p-3",
        active && "border-primary bg-primary/10",
      )}
    >
      <View className="gap-1">
        <Text className="text-sm font-medium text-foreground">{title}</Text>
        <Text className="text-xs text-muted-foreground">{description}</Text>
      </View>
    </Button>
  );
}
