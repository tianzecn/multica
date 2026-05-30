import { describe, expect, it } from "vitest";
import { nextProjectDeviceId } from "./device-selection";

describe("nextProjectDeviceId", () => {
  it("keeps the current device when it is still available", () => {
    expect(
      nextProjectDeviceId("device-b", [
        { device_id: "device-a" },
        { device_id: "device-b" },
      ]),
    ).toBe("device-b");
  });

  it("auto-selects the only available binding", () => {
    expect(nextProjectDeviceId("", [{ device_id: "device-a" }])).toBe("device-a");
  });

  it("requires an explicit choice when multiple bindings are available", () => {
    expect(
      nextProjectDeviceId("", [
        { device_id: "device-a" },
        { device_id: "device-b" },
      ]),
    ).toBe("");
  });

  it("clears stale selections instead of silently switching devices", () => {
    expect(nextProjectDeviceId("device-old", [{ device_id: "device-new" }])).toBe(
      "device-new",
    );
    expect(
      nextProjectDeviceId("device-old", [
        { device_id: "device-a" },
        { device_id: "device-b" },
      ]),
    ).toBe("");
  });
});
