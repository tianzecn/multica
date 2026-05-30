import type { ProjectDeviceBinding } from "@multica/core/types";

export function isOnlineProjectBinding(binding: ProjectDeviceBinding): boolean {
  return binding.status === "online" && !!binding.runtime_id;
}

export function projectDeviceLabel(binding: ProjectDeviceBinding): string {
  return (
    binding.runtime_name ||
    binding.path_alias ||
    binding.path_basename ||
    binding.device_id
  );
}
