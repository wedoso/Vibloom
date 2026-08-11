function semverParts(version: string) {
  return version.replace(/^v/u, "").split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewerVersion(candidate: string, current: string) {
  const candidateParts = semverParts(candidate);
  const currentParts = semverParts(current);
  for (let index = 0; index < Math.max(candidateParts.length, currentParts.length); index += 1) {
    const difference = (candidateParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}
