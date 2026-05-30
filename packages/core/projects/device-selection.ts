export interface ProjectDeviceSelectionCandidate {
  device_id: string;
}

export function nextProjectDeviceId(
  current: string | null | undefined,
  bindings: readonly ProjectDeviceSelectionCandidate[],
): string {
  const currentDeviceId = current?.trim() ?? "";
  if (
    currentDeviceId &&
    bindings.some((binding) => binding.device_id === currentDeviceId)
  ) {
    return currentDeviceId;
  }
  if (bindings.length === 1) {
    return bindings[0]?.device_id ?? "";
  }
  return "";
}
