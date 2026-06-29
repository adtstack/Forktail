import { DEFAULT_FOLDER_SCAN_OPTIONS, type ActiveSession } from "./settings";
import { CORE_TEXT } from "./i18n";
import type { AppLanguage } from "./settings";

export type StartupSessionParseResult =
  | { status: "none" }
  | { status: "valid"; session: ActiveSession; source: StartupSessionSource }
  | { status: "invalid"; message: string };

export type StartupSessionSource = "compare" | "folders" | "merge" | "mergetool";

const COMPARE_FLAGS = new Set(["--compare", "compare"]);
const FOLDER_FLAGS = new Set(["--folders", "--folder", "folders", "folder"]);
const MERGE_FLAGS = new Set(["--merge", "merge"]);
const MERGETOOL_FLAGS = new Set(["--mergetool", "--merge-tool", "mergetool", "merge-tool"]);

export function parseStartupSessionArgs(
  args: string[],
  language: AppLanguage = "en",
): StartupSessionParseResult {
  const normalized = args.filter((arg) => arg.length > 0);
  const separatorIndex = normalized.indexOf("--");
  const appArgs = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
  if (appArgs.length === 0) return { status: "none" };

  const [command, ...rest] = appArgs;
  if (COMPARE_FLAGS.has(command)) return compareSession(rest, language);
  if (FOLDER_FLAGS.has(command)) return folderSession(rest, language);
  if (MERGE_FLAGS.has(command)) return mergeSession(rest, "merge", language);
  if (MERGETOOL_FLAGS.has(command)) return mergeSession(rest, "mergetool", language);
  if (command.startsWith("-")) {
    return invalidStartupArgs(language);
  }
  return compareSession(appArgs, language);
}

function compareSession(paths: string[], language: AppLanguage): StartupSessionParseResult {
  if (paths.length !== 2) return invalidStartupArgs(language);
  return {
    status: "valid",
    source: "compare",
    session: { kind: "compare", leftPath: paths[0], rightPath: paths[1] },
  };
}

function folderSession(paths: string[], language: AppLanguage): StartupSessionParseResult {
  if (paths.length !== 2) return invalidStartupArgs(language);
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
  language: AppLanguage,
): StartupSessionParseResult {
  if (source === "mergetool" ? paths.length !== 4 : paths.length !== 3 && paths.length !== 4) {
    return invalidStartupArgs(language);
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

function invalidStartupArgs(language: AppLanguage): StartupSessionParseResult {
  return {
    status: "invalid",
    message: CORE_TEXT[language].startupInvalidArgs,
  };
}
