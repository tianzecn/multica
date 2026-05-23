import type { Workspace } from "../types";

export interface ChannelsSettings {
  channelsEnabled: boolean;
}

export function deriveChannelsSettings(workspace: Pick<Workspace, "settings"> | null | undefined): ChannelsSettings {
  const settings = (workspace?.settings ?? {}) as Record<string, unknown>;
  return {
    channelsEnabled: settings.channels_enabled === true,
  };
}
