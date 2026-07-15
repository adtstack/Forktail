export type GitToolPlatform = "windows" | "macos" | "linux";

export interface GeneratedGitToolConfig {
  difftool: string;
  mergetool: string;
  usage: string;
}

const INVALID_EXECUTABLE_PATH_MESSAGE = "Invalid Git tool executable path.";
const CONTROL_CHARACTER = /\p{Cc}/u;

export function generateGitToolConfig(
  platform: GitToolPlatform,
  absoluteExecutablePath: string,
): GeneratedGitToolConfig {
  const executablePath = normalizeExecutablePath(platform, absoluteExecutablePath);
  const shellExecutable = shellSingleQuote(executablePath);

  const difftoolCommand = [
    'forktail_local="$LOCAL"',
    'if test "$forktail_local" = /dev/null; then forktail_local=; fi',
    'forktail_remote="$REMOTE"',
    'if test "$forktail_remote" = /dev/null; then forktail_remote=; fi',
    `exec ${shellExecutable} --difftool "$forktail_local" "$forktail_remote"`,
  ].join("; ");

  const mergetoolCommand = [
    'forktail_base="$BASE"',
    'if test "$base_present" = false || test "$forktail_base" = /dev/null; then forktail_base=; fi',
    `exec ${shellExecutable} --mergetool "$forktail_base" "$LOCAL" "$REMOTE" "$MERGED"`,
  ].join("; ");

  return {
    difftool: [
      '[difftool "forktail"]',
      `\tcmd = ${gitConfigDoubleQuote(difftoolCommand)}`,
    ].join("\n"),
    mergetool: [
      '[mergetool "forktail"]',
      `\tcmd = ${gitConfigDoubleQuote(mergetoolCommand)}`,
      "\ttrustExitCode = false",
      "\thideResolved = false",
    ].join("\n"),
    usage: [
      "Copy either tool-specific snippet into Git config manually.",
      "Forktail does not modify Git config or change Git's default tools.",
      "",
      "Run Forktail explicitly:",
      "git difftool --tool=forktail --no-prompt",
      "git mergetool --tool=forktail",
      "",
      "mergetool.forktail.trustExitCode remains false because closing the GUI does not report save success through a reliable process exit code.",
    ].join("\n"),
  };
}

function normalizeExecutablePath(
  platform: GitToolPlatform,
  executablePath: string,
): string {
  if (executablePath.length === 0 || CONTROL_CHARACTER.test(executablePath)) {
    invalidExecutablePath();
  }

  if (platform === "windows") {
    return normalizeWindowsExecutablePath(executablePath);
  }

  if (!executablePath.startsWith("/") || executablePath === "/" || executablePath.endsWith("/")) {
    invalidExecutablePath();
  }

  return executablePath;
}

function normalizeWindowsExecutablePath(executablePath: string): string {
  const normalized = executablePath.replaceAll("\\", "/");
  const isDriveAbsolute = /^[A-Za-z]:\//.test(normalized);

  if (isDriveAbsolute) {
    if (/^[A-Za-z]:\/$/.test(normalized) || normalized.endsWith("/")) {
      invalidExecutablePath();
    }
    return normalized;
  }

  if (!normalized.startsWith("//") || normalized.startsWith("//?/") || normalized.startsWith("//./")) {
    invalidExecutablePath();
  }

  const segments = normalized.slice(2).split("/");
  if (segments.length < 3 || segments.some((segment) => segment.length === 0)) {
    invalidExecutablePath();
  }

  return normalized;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function gitConfigDoubleQuote(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}"`;
}

function invalidExecutablePath(): never {
  throw new Error(INVALID_EXECUTABLE_PATH_MESSAGE);
}
