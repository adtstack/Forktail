import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  GIT_TOOL_EXECUTABLE_PATH_EXAMPLES,
  GitToolSetup,
  applyDetectedGitToolExecutablePath,
  copyGitToolSnippet,
  gitToolCopyStatus,
  gitToolSetupModel,
  type GitToolSetupCopyResult,
} from "./GitToolSetup";

describe("GitToolSetup", () => {
  it("does not infer the desktop OS from browser navigator hints", () => {
    const source = readFileSync(new URL("./GitToolSetup.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("navigator.platform");
    expect(source).not.toContain("navigator.userAgent");
  });

  it("shows documented paths only as non-active examples and requires a real path", () => {
    expect(GIT_TOOL_EXECUTABLE_PATH_EXAMPLES).toEqual({
      macos: "/Applications/forktail.app/Contents/MacOS/forktail",
      windows: "C:\\Users\\<USER>\\AppData\\Local\\forktail\\forktail.exe",
      linux: "/home/<USER>/Applications/forktail.AppImage",
    });

    for (const platform of Object.keys(GIT_TOOL_EXECUTABLE_PATH_EXAMPLES)) {
      const markup = renderToStaticMarkup(
        <GitToolSetup
          languageMode="en"
          initialPlatform={platform as keyof typeof GIT_TOOL_EXECUTABLE_PATH_EXAMPLES}
        />,
      );
      expect(markup).toContain('value=""');
      expect(markup).toContain("Example only—do not copy it as-is");
      expect(markup).not.toContain("[difftool &quot;forktail&quot;]");
      expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    }
  });

  it("shows copy-only difftool and mergetool snippets without apply/default controls", () => {
    const markup = renderToStaticMarkup(
      <GitToolSetup
        languageMode="en"
        initialPlatform="macos"
        initialExecutablePath="/Applications/forktail.app/Contents/MacOS/forktail"
      />,
    );

    expect(markup).toContain("aria-label=\"Git tool setup\"");
    expect(markup).toContain("macOS");
    expect(markup).toContain("Detected automatically");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<input");
    expect(markup).toContain("Copy difftool snippet");
    expect(markup).toContain("Copy mergetool snippet");
    expect(markup).toContain("[difftool &quot;forktail&quot;]");
    expect(markup).toContain("[mergetool &quot;forktail&quot;]");
    expect(markup).toContain("trustExitCode = false");
    expect(markup).toContain("hideResolved = false");
    expect(markup).toContain("git difftool --tool=forktail --no-prompt");
    expect(markup).toContain("git mergetool --tool=forktail");
    expect(markup).toContain("trustExitCode remains false");
    expect(markup).toContain("does not modify Git config or change Git&#x27;s default tools");
    expect(markup).not.toContain(">Apply<");
    expect(markup).not.toContain(">Set default<");
  });

  it("hides OS and path inputs when the packaged runtime is detected", () => {
    const markup = renderToStaticMarkup(
      <GitToolSetup
        languageMode="en"
        initialRuntimeProfile={{
          platform: "macos",
          executablePath: "/Applications/forktail.app/Contents/MacOS/forktail",
          detection: "detected",
        }}
      />,
    );

    expect(markup).toContain("Detected automatically");
    expect(markup).toContain("macOS");
    expect(markup).toContain("/Applications/forktail.app/Contents/MacOS/forktail");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<input");
  });

  it("shows a path fallback without an OS selector or initial error flash", () => {
    const fallbackMarkup = renderToStaticMarkup(
      <GitToolSetup
        languageMode="en"
        initialRuntimeProfile={{
          platform: "linux",
          executablePath: null,
          detection: "manualRequired",
        }}
      />,
    );
    const loadingMarkup = renderToStaticMarkup(<GitToolSetup languageMode="en" />);

    expect(fallbackMarkup).toContain("Linux");
    expect(fallbackMarkup).toContain("Enter the executable path manually");
    expect(fallbackMarkup).toContain("Advanced platform override");
    expect(fallbackMarkup).toContain("<input");
    expect(fallbackMarkup).not.toContain("<select");
    expect(loadingMarkup).toContain("Detecting packaged runtime");
    expect(loadingMarkup).not.toContain('role="alert"');
  });

  it("renders Korean guidance from its isolated localized text map", () => {
    const markup = renderToStaticMarkup(<GitToolSetup languageMode="ko" />);

    expect(markup).toContain("Git 도구 설정");
    expect(markup).toContain("difftool 스니펫 복사");
    expect(markup).toContain("aria-label=\"Difftool Git config 스니펫\"");
    expect(markup).toContain("forktail은 Git 설정이나 기본 도구를 변경하지 않습니다.");
  });
});

describe("gitToolSetupModel", () => {
  it("returns generated snippets for a valid absolute executable path", () => {
    const model = gitToolSetupModel(
      "linux",
      "/home/alice/Applications/forktail.AppImage",
      "en",
    );

    expect(model.error).toBeNull();
    expect(model.config?.difftool).toContain("--difftool");
    expect(model.config?.mergetool).toContain("--mergetool");
  });

  it("turns invalid paths into actionable guidance without exposing generator errors", () => {
    expect(gitToolSetupModel("linux", "relative/forktail", "en")).toEqual({
      config: null,
      error:
        "Enter an absolute Forktail executable path. Do not copy this example as-is; verify your installation path: /home/<USER>/Applications/forktail.AppImage",
    });
    expect(gitToolSetupModel("windows", "forktail.exe", "ko")).toEqual({
      config: null,
      error:
        "forktail 실행 파일의 절대 경로를 입력하세요. 예시를 그대로 복사하지 말고 실제 설치 경로를 확인하세요: C:\\Users\\<USER>\\AppData\\Local\\forktail\\forktail.exe",
    });
  });
});

describe("applyDetectedGitToolExecutablePath", () => {
  it("populates an untouched empty field with the packaged executable path", () => {
    expect(applyDetectedGitToolExecutablePath(
      { value: "", userEdited: false },
      "/Applications/forktail.app/Contents/MacOS/forktail",
    )).toEqual({
      value: "/Applications/forktail.app/Contents/MacOS/forktail",
      userEdited: false,
    });
  });

  it("does not let a late runtime lookup overwrite a user edit", () => {
    expect(applyDetectedGitToolExecutablePath(
      { value: "/custom/forktail", userEdited: true },
      "/Applications/forktail.app/Contents/MacOS/forktail",
    )).toEqual({ value: "/custom/forktail", userEdited: true });
  });
});

describe("copyGitToolSnippet", () => {
  it("reports copied after the clipboard writer succeeds", async () => {
    const writer = vi.fn(async () => {});

    const result: GitToolSetupCopyResult = await copyGitToolSnippet("snippet", writer);

    expect(result).toBe("copied");
    expect(writer).toHaveBeenCalledWith("snippet");
  });

  it("falls back to manual selection guidance when clipboard writing fails", async () => {
    const writer = vi.fn(async () => {
      throw new Error("clipboard denied");
    });

    const result: GitToolSetupCopyResult = await copyGitToolSnippet("snippet", writer);

    expect(result).toBe("manual");
    expect(gitToolCopyStatus(result, "mergetool", "en")).toBe(
      "Clipboard access failed. Select the visible snippet and copy it manually.",
    );
  });
});
