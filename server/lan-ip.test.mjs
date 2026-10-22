import { describe, expect, it } from "vitest";
import { findLanIp } from "./lan-ip.mjs";

const ipv4 = (address, internal = false) => ({
  address,
  family: "IPv4",
  internal,
});

describe("findLanIp", () => {
  it("prefers Wi-Fi over VirtualBox and link-local adapters", () => {
    const interfaces = {
      "Loopback Pseudo-Interface 1": [ipv4("127.0.0.1", true)],
      "Ethernet 2": [ipv4("192.168.56.1")],
      "Ethernet": [ipv4("169.254.6.115")],
      "Wi-Fi": [ipv4("192.168.1.8")],
    };

    expect(findLanIp(interfaces)).toBe("192.168.1.8");
  });

  it("falls back to a real Ethernet adapter when Wi-Fi is absent", () => {
    const interfaces = {
      "Ethernet": [ipv4("10.0.0.20")],
      "Ethernet 2": [ipv4("192.168.56.1")],
    };

    expect(findLanIp(interfaces)).toBe("10.0.0.20");
  });

  it("skips internal and link-local addresses", () => {
    const interfaces = {
      "Wi-Fi": [ipv4("169.254.10.20")],
      "Ethernet": [ipv4("127.0.0.1", true)],
    };

    expect(findLanIp(interfaces)).toBeNull();
  });

  it("returns null when there are no IPv4 adapters", () => {
    expect(findLanIp({})).toBeNull();
  });

  it("never returns the VirtualBox host-only address", () => {
    expect(findLanIp({ "Ethernet 2": [ipv4("192.168.56.1")] })).toBeNull();
  });

  it("prefers Wi-Fi over a real Ethernet address", () => {
    const interfaces = {
      "Ethernet": [ipv4("10.0.0.20")],
      "Wi-Fi": [ipv4("192.168.1.8")],
    };

    expect(findLanIp(interfaces)).toBe("192.168.1.8");
  });

  it("accepts numeric family 4", () => {
    const interfaces = {
      "Wi-Fi": [{ address: "192.168.1.8", family: 4, internal: false }],
    };

    expect(findLanIp(interfaces)).toBe("192.168.1.8");
  });

  it("skips internal non-loopback addresses", () => {
    const interfaces = {
      "Ethernet": [{ address: "10.0.0.20", family: "IPv4", internal: true }],
    };

    expect(findLanIp(interfaces)).toBeNull();
  });
});
