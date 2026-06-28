import { DEFAULT_FOLDER_SCAN_OPTIONS, type ActiveSession } from "./settings";

export type StartupSessionParseResult =
  | { status: "none" }
  | { status: "valid"; session: ActiveSession; source: StartupSessionSource }
  | { status: "invalid"; message: string };

export type StartupSessionSource = "compare" | "folders" | "merge" | "mergetool";

const COMPARE_FLAGS = new Set(["--compare", "compare"]);
const FOLDER_FLAGS = new Set(["--folders", "--folder", "folders", "folder"]);
const MERGE_FLAGS = new Set(["--merge", "merge"]);
const MERGETOOL_FLAGS = new Set(["--mergetool", "--merge-tool", "mergetool", "merge-tool"]);

export function parseStartupSessionArgs(args: string[]): StartupSessionParseResult {
  const normalized = args.filter((arg) => arg.length > 0);
  const separatorIndex = normalized.indexOf("--");
  const appArgs = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
  if (appArgs.length === 0) return { status: "none" };

  const [command, ...rest] = appArgs;
  if (COMPARE_FLAGS.has(command)) return compareSession(rest);
  if (FOLDER_FLAGS.has(command)) return folderSession(rest);
  if (MERGE_FLAGS.has(command)) return mergeSession(rest, "merge");
  if (MERGETOOL_FLAGS.has(command)) return mergeSession(rest, "mergetool");
  if (command.startsWith("-")) {
    return invalidStartupArgs();
  }
  return compareSession(appArgs);
}

function compareSession(paths: string[]): StartupSessionParseResult {
  if (paths.length !== 2) return invalidStartupArgs();
  return {
    status: "valid",
    source: "compare",
    session: { kind: "compare", leftPath: paths[0], rightPath: paths[1] },
  };
}

function folderSession(paths: string[]): StartupSessionParseResult {
  if (paths.length !== 2) return invalidStartupArgs();
  return {
    status: "valid",
    source: "folders",
    session: {
      kind: "folders",
      leftRoot: paths[0],
      rightRoot: paths[1],
      options: DEFAULT_FOLDER_SCAN_OPTIONS,
    },
  };
}

function mergeSession(
  paths: string[],
  source: Extract<StartupSessionSource, "merge" | "mergetool">,
): StartupSessionParseResult {
  if (source === "mergetool" ? paths.length !== 4 : paths.length !== 3 && paths.length !== 4) {
    return invalidStartupArgs();
  }
  return {
    status: "valid",
    source,
    session: {
      kind: "merge",
      basePath: paths[0],
      oursPath: paths[1],
      theirsPath: paths[2],
      outputPath: paths[3] ?? null,
    },
  };
}

function invalidStartupArgs(): StartupSessionParseResult {
  return {
    status: "invalid",
    message:
      "시작 인자를 이해하지 못했습니다. 사용법: forktail left right, forktail --folders left right, forktail --merge base ours theirs [output], forktail --mergetool base ours theirs output",
  };
}
