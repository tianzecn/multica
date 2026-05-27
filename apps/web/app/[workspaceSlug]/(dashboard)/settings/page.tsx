import { SettingsPage } from "@multica/views/settings";

const cloudRuntimeEnabled =
  process.env.NEXT_PUBLIC_ENABLE_CLOUD_RUNTIME === "true";

export default function Page() {
  return <SettingsPage runtimesPageProps={{ cloudRuntimeEnabled }} />;
}
