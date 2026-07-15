import {
  DEFAULT_FOLDER_SCAN_OPTIONS,
  type ActiveSession,
  type AppLanguage,
} from "./settings";
import { CORE_TEXT } from "./i18n";

export interface MergetoolStartupSession {
  kind: "mergetool";
  basePath: string | null;
  oursPath: string;
  theirsPath: string;
  outputPath: string;
}

export interface DifftoolStartupSession {
  kind: "difftool";
  localPath: string | null;
  remotePath: string | null;
}

export type StartupSession = ActiveSession | DifftoolStartupSession | MergetoolStartupSession;

export type StartupSessionParseResult =
  | { status: "none" }
  | {
      status: "valid";
      session: Extract<ActiveSession, { kind: "compare" }>;
      source: "compare";
    }
  | {
      status: "valid";
      session: Extract<ActiveSession, { kind: "folders" }>;
      source: "folders";
    }
  | {
      status: "valid";
      session: Extract<ActiveSession, { kind: "merge" }>;
      source: "merge";
    }
  | { status: "valid"; session: DifftoolStartupSession; source: "difftool" }
  | { status: "valid"; session: MergetoolStartupSession; source: "mergetool" }
  | { status: "invalid"; message: string };

export type StartupSessionSource = "compare" | "difftool" | "folders" | "merge" | "mergetool";

const COMPARE_FLAGS = new Set(["--compare", "compare"]);
const DIFFTOOL_FLAGS = new Set(["--difftool", "--diff-tool", "difftool"]);
const FOLDER_FLAGS = new Set(["--folders", "--folder", "folders", "folder"]);
const MERGE_FLAGS = new Set(["--merge", "merge"]);
const MERGETOOL_FLAGS = new Set(["--mergetool", "--merge-tool", "mergetool", "merge-tool"]);

export function parseStartupSessionArgs(
  args: string[],
  language: AppLanguage = "en",
): StartupSessionParseResult {
  const separatorIndex = args.indexOf("--");
  const rawAppArgs = separatorIndex >= 0 ? args.slice(separatorIndex + 1) : args;
  const commandIndex = rawAppArgs.findIndex((arg) => arg.length > 0);
  if (commandIndex < 0) return { status: "none" };

  const rawCommand = rawAppArgs[commandIndex];
  if (DIFFTOOL_FLAGS.has(rawCommand)) {
    return difftoolSession(rawAppArgs.slice(commandIndex + 1), language);
  }
  if (MERGETOOL_FLAGS.has(rawCommand)) {
    return mergetoolSession(rawAppArgs.slice(commandIndex + 1), language);
  }

  const appArgs = rawAppArgs.filter((arg) => arg.length > 0);
  const [command, ...rest] = appArgs;
  if (COMPARE_FLAGS.has(command)) return compareSession(rest, language);
  if (FOLDER_FLAGS.has(command)) return folderSession(rest, language);
  if (MERGE_FLAGS.has(command)) return mergeSession(rest, language);
  if (command.startsWith("-")) {
    return invalidStartupArgs(language);
  }
  return compareSession(appArgs, language);
}

function difftoolSession(
  paths: string[],
  language: AppLanguage,
): StartupSessionParseResult {
  if (paths.length !== 2) return invalidStartupArgs(language);

  const localPath = difftoolPath(paths[0]);
  const remotePath = difftoolPath(paths[1]);
  if (localPath === null && remotePath === null) return invalidStartupArgs(language);

  return {
    status: "valid",
    source: "difftool",
    session: { kind: "difftool", localPath, remotePath },
  };
}

function difftoolPath(path: string): string | null {
  return path === "" || path === "/dev/null" ? null : path;
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
  language: AppLanguage,
): StartupSessionParseResult {
  if (paths.length !== 3 && paths.length !== 4) {
    return invalidStartupArgs(language);
  }
  return {
    status: "valid",
    source: "merge",
    session: {
      kind: "merge",
      basePath: paths[0],
      oursPath: paths[1],
      theirsPath: paths[2],
      outputPath: paths[3] ?? null,
    },
  };
}

function mergetoolSession(
  paths: string[],
  language: AppLanguage,
): StartupSessionParseResult {
  if (paths.length !== 4 || paths.slice(1).some((path) => path.length === 0)) {
    return invalidStartupArgs(language);
  }

  return {
    status: "valid",
    source: "mergetool",
    session: {
      kind: "mergetool",
      basePath: paths[0].length === 0 ? null : paths[0],
      oursPath: paths[1],
      theirsPath: paths[2],
      outputPath: paths[3],
    },
  };
}

function invalidStartupArgs(language: AppLanguage): StartupSessionParseResult {
  return {
    status: "invalid",
    message: CORE_TEXT[language].startupInvalidArgs,
  };
}
