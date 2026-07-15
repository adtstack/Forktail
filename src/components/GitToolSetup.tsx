import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import { gitToolExecutablePath, isTauriRuntime } from "../core/bridge";
import {
  generateGitToolConfig,
  type GeneratedGitToolConfig,
  type GitToolPlatform,
} from "../core/gitToolConfig";
import { writeClipboardText } from "../core/pathCopy";
import type { AppLanguage } from "../core/settings";

export const GIT_TOOL_EXECUTABLE_PATH_EXAMPLES: Readonly<Record<GitToolPlatform, string>> = {
  macos: "/Applications/forktail.app/Contents/MacOS/forktail",
  windows: "C:\\Users\\<USER>\\AppData\\Local\\forktail\\forktail.exe",
  linux: "/home/<USER>/Applications/forktail.AppImage",
};

const PLATFORM_OPTIONS: ReadonlyArray<readonly [GitToolPlatform, string]> = [
  ["windows", "Windows"],
  ["macos", "macOS"],
  ["linux", "Linux"],
];

const GIT_TOOL_SETUP_TEXT = {
  en: {
    title: "Git tool setup",
    description: "Generate explicit tool-specific snippets, then copy them into Git config manually.",
    platform: "Platform",
    executablePath: "Forktail executable path",
    pathExample: (example: string) =>
      `Example only—do not copy it as-is. Verify your installation path: ${example}`,
    difftool: "Difftool",
    mergetool: "Mergetool",
    copyDifftool: "Copy difftool snippet",
    copyMergetool: "Copy mergetool snippet",
    copyOnly: "Copy only",
    usageTitle: "Run Git with Forktail",
    usageAria: "Git difftool and mergetool usage",
    snippetAria: (label: string) => `${label} Git config snippet`,
    copiedDifftool: "Difftool snippet copied.",
    copiedMergetool: "Mergetool snippet copied.",
    manualCopy: "Clipboard access failed. Select the visible snippet and copy it manually.",
    safety: "Forktail does not modify Git config or change Git's default tools.",
    invalidPath: (example: string) =>
      `Enter an absolute Forktail executable path. Do not copy this example as-is; verify your installation path: ${example}`,
  },
  ko: {
    title: "Git 도구 설정",
    description: "도구별 설정 스니펫을 만든 뒤 Git config에 직접 복사하세요.",
    platform: "플랫폼",
    executablePath: "forktail 실행 파일 경로",
    pathExample: (example: string) =>
      `예시를 그대로 복사하지 말고 실제 설치 경로를 확인하세요: ${example}`,
    difftool: "Difftool",
    mergetool: "Mergetool",
    copyDifftool: "difftool 스니펫 복사",
    copyMergetool: "mergetool 스니펫 복사",
    copyOnly: "복사 전용",
    usageTitle: "Git에서 forktail 실행",
    usageAria: "Git difftool 및 mergetool 실행 안내",
    snippetAria: (label: string) => `${label} Git config 스니펫`,
    copiedDifftool: "difftool 스니펫을 복사했습니다.",
    copiedMergetool: "mergetool 스니펫을 복사했습니다.",
    manualCopy: "클립보드에 복사하지 못했습니다. 표시된 스니펫을 선택해 직접 복사하세요.",
    safety: "forktail은 Git 설정이나 기본 도구를 변경하지 않습니다.",
    invalidPath: (example: string) =>
      `forktail 실행 파일의 절대 경로를 입력하세요. 예시를 그대로 복사하지 말고 실제 설치 경로를 확인하세요: ${example}`,
  },
} as const;

export interface GitToolSetupModel {
  config: GeneratedGitToolConfig | null;
  error: string | null;
}

export type GitToolSetupCopyResult = "copied" | "manual";
export type GitToolSnippetKind = "difftool" | "mergetool";

export interface GitToolRuntimePlatformHint {
  platform?: string;
  userAgent?: string;
}

interface GitToolSetupProps {
  languageMode: AppLanguage;
  initialPlatform?: GitToolPlatform;
  initialExecutablePath?: string;
}

export interface GitToolExecutablePathState {
  value: string;
  userEdited: boolean;
}

export function gitToolSetupModel(
  platform: GitToolPlatform,
  executablePath: string,
  languageMode: AppLanguage,
): GitToolSetupModel {
  try {
    return {
      config: generateGitToolConfig(platform, executablePath),
      error: null,
    };
  } catch {
    return {
      config: null,
      error: GIT_TOOL_SETUP_TEXT[languageMode].invalidPath(
        GIT_TOOL_EXECUTABLE_PATH_EXAMPLES[platform],
      ),
    };
  }
}

export function detectGitToolPlatform(
  hint: GitToolRuntimePlatformHint | null = browserPlatformHint(),
): GitToolPlatform {
  if (!hint) return "macos";

  const platform = hint.platform?.toLowerCase() ?? "";
  const userAgent = hint.userAgent?.toLowerCase() ?? "";
  if (platform.startsWith("win") || userAgent.includes("windows")) return "windows";
  if (
    platform.includes("mac") ||
    userAgent.includes("macintosh") ||
    userAgent.includes("mac os")
  ) {
    return "macos";
  }
  if (
    platform.includes("linux") ||
    userAgent.includes("linux") ||
    userAgent.includes("x11")
  ) {
    return "linux";
  }
  return "macos";
}

export async function copyGitToolSnippet(
  snippet: string,
  writer: (text: string) => Promise<void> = writeClipboardText,
): Promise<GitToolSetupCopyResult> {
  try {
    await writer(snippet);
    return "copied";
  } catch {
    return "manual";
  }
}

export function gitToolCopyStatus(
  result: GitToolSetupCopyResult,
  kind: GitToolSnippetKind,
  languageMode: AppLanguage,
): string {
  const text = GIT_TOOL_SETUP_TEXT[languageMode];
  if (result === "manual") return text.manualCopy;
  return kind === "difftool" ? text.copiedDifftool : text.copiedMergetool;
}

export function applyDetectedGitToolExecutablePath(
  current: GitToolExecutablePathState,
  detectedPath: string,
): GitToolExecutablePathState {
  if (current.userEdited) return current;
  return { value: detectedPath, userEdited: false };
}

export function GitToolSetup({
  languageMode,
  initialPlatform,
  initialExecutablePath,
}: GitToolSetupProps) {
  const detectedInitialPlatform = initialPlatform ?? detectGitToolPlatform();
  const [platform, setPlatform] = useState<GitToolPlatform>(detectedInitialPlatform);
  const [executablePathState, setExecutablePathState] = useState<GitToolExecutablePathState>({
    value: initialExecutablePath ?? "",
    userEdited: initialExecutablePath !== undefined,
  });
  const executablePath = executablePathState.value;
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const difftoolRef = useRef<HTMLTextAreaElement>(null);
  const mergetoolRef = useRef<HTMLTextAreaElement>(null);
  const text = GIT_TOOL_SETUP_TEXT[languageMode];
  const model = useMemo(
    () => gitToolSetupModel(platform, executablePath, languageMode),
    [executablePath, languageMode, platform],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let active = true;
    void gitToolExecutablePath()
      .then((detectedPath) => {
        if (!active) return;
        setExecutablePathState((current) =>
          applyDetectedGitToolExecutablePath(current, detectedPath)
        );
      })
      .catch(() => {
        // The empty field and platform-specific example remain actionable fallback guidance.
      });

    return () => {
      active = false;
    };
  }, []);

  const changePlatform = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextPlatform = event.target.value as GitToolPlatform;
    setPlatform(nextPlatform);
    setExecutablePathState({ value: "", userEdited: true });
    setCopyStatus(null);
  };

  const copySnippet = async (kind: GitToolSnippetKind) => {
    const snippet = model.config?.[kind];
    if (!snippet) return;

    const result = await copyGitToolSnippet(snippet);
    if (result === "manual") {
      const textarea = kind === "difftool" ? difftoolRef.current : mergetoolRef.current;
      textarea?.focus();
      textarea?.select();
      setCopyStatus(gitToolCopyStatus(result, kind, languageMode));
      return;
    }

    setCopyStatus(gitToolCopyStatus(result, kind, languageMode));
  };

  return (
    <section className="git-tool-setup" aria-label={text.title}>
      <div className="git-tool-setup-heading">
        <div>
          <strong>{text.title}</strong>
          <p>{text.description}</p>
        </div>
        <span className="git-tool-copy-only">{text.copyOnly}</span>
      </div>

      <div className="git-tool-controls">
        <label>
          <span>{text.platform}</span>
          <select value={platform} onChange={changePlatform}>
            {PLATFORM_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.executablePath}</span>
          <input
            type="text"
            value={executablePath}
            placeholder={GIT_TOOL_EXECUTABLE_PATH_EXAMPLES[platform]}
            onChange={(event) => {
              setExecutablePathState({ value: event.target.value, userEdited: true });
              setCopyStatus(null);
            }}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={model.error ? true : undefined}
            aria-describedby={model.error ? "git-tool-path-error" : undefined}
          />
          <small>{text.pathExample(GIT_TOOL_EXECUTABLE_PATH_EXAMPLES[platform])}</small>
        </label>
      </div>

      {model.error && (
        <p id="git-tool-path-error" className="git-tool-error" role="alert">
          {model.error}
        </p>
      )}

      <div className="git-tool-snippets">
        <GitToolSnippet
          label={text.difftool}
          ariaLabel={text.snippetAria(text.difftool)}
          copyLabel={text.copyDifftool}
          value={model.config?.difftool ?? ""}
          textareaRef={difftoolRef}
          disabled={!model.config}
          onCopy={() => { void copySnippet("difftool"); }}
        />
        <GitToolSnippet
          label={text.mergetool}
          ariaLabel={text.snippetAria(text.mergetool)}
          copyLabel={text.copyMergetool}
          value={model.config?.mergetool ?? ""}
          textareaRef={mergetoolRef}
          disabled={!model.config}
          onCopy={() => { void copySnippet("mergetool"); }}
        />
      </div>

      {model.config && (
        <section className="git-tool-usage">
          <strong>{text.usageTitle}</strong>
          <pre aria-label={text.usageAria}>{model.config.usage}</pre>
        </section>
      )}

      <p className="git-tool-safety">{text.safety}</p>
      {copyStatus && <p className="git-tool-copy-status" role="status">{copyStatus}</p>}
    </section>
  );
}

function GitToolSnippet({
  label,
  ariaLabel,
  copyLabel,
  value,
  textareaRef,
  disabled,
  onCopy,
}: {
  label: string;
  ariaLabel: string;
  copyLabel: string;
  value: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
  onCopy: () => void;
}) {
  return (
    <section className="git-tool-snippet" aria-label={label}>
      <div className="git-tool-snippet-heading">
        <strong>{label}</strong>
        <button type="button" onClick={onCopy} disabled={disabled}>{copyLabel}</button>
      </div>
      <textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        value={value}
        readOnly
        rows={6}
        spellCheck={false}
      />
    </section>
  );
}

function browserPlatformHint(): GitToolRuntimePlatformHint | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  return {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
  };
}
