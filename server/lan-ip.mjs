import { networkInterfaces } from "node:os";

const isEligibleAddress = (address) => {
  if (address.family !== "IPv4" && address.family !== 4) {
    return false;
  }

  if (address.internal) {
    return false;
  }

  const [first, second, third] = address.address
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  // Skip loopback and link-local addresses.
  if (first === 127) {
    return false;
  }

  if (first === 169 && second === 254) {
    return false;
  }

  // Skip the VirtualBox host-only range.
  if (first === 192 && second === 168 && third === 56) {
    return false;
  }

  return true;
};

export function findLanIp(interfaces = networkInterfaces()) {
  const candidates = [];

  for (const [name, addresses] of Object.entries(interfaces ?? {})) {
    for (const address of addresses ?? []) {
      if (!isEligibleAddress(address)) {
        continue;
      }

      candidates.push({ name, address: address.address });
    }
  }

  const findFirst = (pattern) =>
    candidates.find((candidate) => pattern.test(candidate.name));

  const preferred =
    findFirst(/wi-?fi/i) ?? findFirst(/ethernet/i) ?? candidates[0];

  return preferred ? preferred.address : null;
}
