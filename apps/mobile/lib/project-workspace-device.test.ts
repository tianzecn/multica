import { describe, expect, it } from "vitest";
import type { ProjectDeviceBinding } from "@multica/core/types";
import {
  isOnlineProjectBinding,
  projectDeviceLabel,
} from "@/lib/project-workspace-device";

function binding(
  patch: Partial<ProjectDeviceBinding> = {},
): ProjectDeviceBinding {
  return {
    id: "binding-1",
    project_id: "project-1",
    workspace_id: "workspace-1",
    runtime_id: "runtime-1",
    runtime_name: "",
    device_id: "device-1",
    primary_repo_url: "https://github.com/acme/app.git",
    status: "online",
    capabilities: {},
    path_alias: "",
    path_basename: "app",
    last_seen_at: null,
    created_at: "2026-05-29T00:00:00Z",
    updated_at: "2026-05-29T00:00:00Z",
    ...patch,
  };
}

describe("mobile project workspace device helpers", () => {
  it("treats only online bindings with a runtime id as controllable", () => {
    expect(isOnlineProjectBinding(binding())).toBe(true);
    expect(isOnlineProjectBinding(binding({ status: "offline" }))).toBe(false);
    expect(isOnlineProjectBinding(binding({ runtime_id: null }))).toBe(false);
  });

  it("labels devices without exposing absolute local paths", () => {
    expect(projectDeviceLabel(binding({ runtime_name: "Mac Studio" }))).toBe(
      "Mac Studio",
    );
    expect(projectDeviceLabel(binding({ path_alias: "client-app" }))).toBe(
      "client-app",
    );
    expect(projectDeviceLabel(binding({ path_basename: "app" }))).toBe("app");
    expect(projectDeviceLabel(binding({ path_basename: "" }))).toBe("device-1");
  });
});
