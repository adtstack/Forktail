const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MAX_CARGO_VERSION_COMPONENT = "18446744073709551615";

/**
 * Parse a strict SemVer value without accepting a leading `v`.
 * Numeric components remain strings so arbitrarily large valid identifiers
 * are compared without losing precision.
 */
export function parseSemver(value, label = "version") {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  const match = SEMVER_PATTERN.exec(value);
  if (!match) {
    throw new Error(`${label} must be valid SemVer, got ${JSON.stringify(value)}.`);
  }

  for (const [index, component] of match.slice(1, 4).entries()) {
    if (compareNumericIdentifier(component, MAX_CARGO_VERSION_COMPONENT) > 0) {
      const componentName = ["major", "minor", "patch"][index];
      throw new Error(
        `${label} ${componentName} component exceeds Cargo's unsigned 64-bit limit.`,
      );
    }
  }

  const prerelease = match[4] ? match[4].split(".") : [];
  if (
    prerelease.some(
      (identifier) => /^\d+$/.test(identifier) && !/^(0|[1-9]\d*)$/.test(identifier),
    )
  ) {
    throw new Error(`${label} has a numeric prerelease identifier with a leading zero.`);
  }

  return Object.freeze({
    raw: value,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: Object.freeze(prerelease),
    build: Object.freeze(match[5] ? match[5].split(".") : []),
  });
}

/** Compare two parsed or string SemVer values using SemVer precedence. */
export function compareSemver(leftValue, rightValue) {
  const left = typeof leftValue === "string" ? parseSemver(leftValue, "left version") : leftValue;
  const right =
    typeof rightValue === "string" ? parseSemver(rightValue, "right version") : rightValue;

  for (const field of ["major", "minor", "patch"]) {
    const result = compareNumericIdentifier(left[field], right[field]);
    if (result !== 0) return result;
  }

  if (left.prerelease.length === 0 && right.prerelease.length > 0) return 1;
  if (left.prerelease.length > 0 && right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];

    if (leftIdentifier == null) return -1;
    if (rightIdentifier == null) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return compareNumericIdentifier(leftIdentifier, rightIdentifier);
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }

  // Build metadata does not affect SemVer precedence.
  return 0;
}

/** Normalize `vX.Y.Z` or `X.Y.Z` to the project-file form `X.Y.Z`. */
export function normalizeReleaseVersion(value, label = "release version") {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const version = value.startsWith("v") ? value.slice(1) : value;
  parseSemver(version, label);
  return version;
}

/** Normalize `vX.Y.Z` or `X.Y.Z` to the release-tag form `vX.Y.Z`. */
export function normalizeReleaseTag(value, label = "release version") {
  return `v${normalizeReleaseVersion(value, label)}`;
}

function compareNumericIdentifier(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
