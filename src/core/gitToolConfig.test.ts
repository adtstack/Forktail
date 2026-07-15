import { describe, expect, it } from "vitest";
import { generateGitToolConfig, type GitToolPlatform } from "./gitToolConfig";

describe("generateGitToolConfig", () => {
  it("preserves Git's missing-base signal as an empty mergetool argument", () => {
    const { mergetool } = generateGitToolConfig(
      "macos",
      "/Applications/forktail.app/Contents/MacOS/forktail",
    );

    expect(mergetool).toContain(
      'if test \\"$base_present\\" = false || test \\"$forktail_base\\" = /dev/null; then forktail_base=; fi',
    );
    expect(mergetool).not.toContain('test ! -s \\"$forktail_base\\"');
  });

  it("snapshots macOS shell and git-config quoting for spaces, Unicode, and apostrophes", () => {
    const config = generateGitToolConfig(
      "macos",
      "/Applications/Forktail O'Brien 한글.app/Contents/MacOS/forktail",
    );

    expect(config).toMatchInlineSnapshot(`
      {
        "difftool": "[difftool "forktail"]
      \tcmd = "forktail_local=\\"$LOCAL\\"; if test \\"$forktail_local\\" = /dev/null; then forktail_local=; fi; forktail_remote=\\"$REMOTE\\"; if test \\"$forktail_remote\\" = /dev/null; then forktail_remote=; fi; exec '/Applications/Forktail O'\\\\''Brien 한글.app/Contents/MacOS/forktail' --difftool \\"$forktail_local\\" \\"$forktail_remote\\""",
        "mergetool": "[mergetool "forktail"]
      \tcmd = "forktail_base=\\"$BASE\\"; if test \\"$base_present\\" = false || test \\"$forktail_base\\" = /dev/null; then forktail_base=; fi; exec '/Applications/Forktail O'\\\\''Brien 한글.app/Contents/MacOS/forktail' --mergetool \\"$forktail_base\\" \\"$LOCAL\\" \\"$REMOTE\\" \\"$MERGED\\""
      \ttrustExitCode = false
      \thideResolved = false",
        "usage": "Copy either tool-specific snippet into Git config manually.
      Forktail does not modify Git config or change Git's default tools.

      Run Forktail explicitly:
      git difftool --tool=forktail --no-prompt
      git mergetool --tool=forktail

      mergetool.forktail.trustExitCode remains false because closing the GUI does not report save success through a reliable process exit code.",
      }
    `);
  });

  it("snapshots Windows drive paths after normalizing separators for Git's shell", () => {
    const config = generateGitToolConfig(
      "windows",
      "C:\\Program Files\\Forktail O'Brien 한글\\forktail.exe",
    );

    expect(config).toMatchInlineSnapshot(`
      {
        "difftool": "[difftool "forktail"]
      \tcmd = "forktail_local=\\"$LOCAL\\"; if test \\"$forktail_local\\" = /dev/null; then forktail_local=; fi; forktail_remote=\\"$REMOTE\\"; if test \\"$forktail_remote\\" = /dev/null; then forktail_remote=; fi; exec 'C:/Program Files/Forktail O'\\\\''Brien 한글/forktail.exe' --difftool \\"$forktail_local\\" \\"$forktail_remote\\""",
        "mergetool": "[mergetool "forktail"]
      \tcmd = "forktail_base=\\"$BASE\\"; if test \\"$base_present\\" = false || test \\"$forktail_base\\" = /dev/null; then forktail_base=; fi; exec 'C:/Program Files/Forktail O'\\\\''Brien 한글/forktail.exe' --mergetool \\"$forktail_base\\" \\"$LOCAL\\" \\"$REMOTE\\" \\"$MERGED\\""
      \ttrustExitCode = false
      \thideResolved = false",
        "usage": "Copy either tool-specific snippet into Git config manually.
      Forktail does not modify Git config or change Git's default tools.

      Run Forktail explicitly:
      git difftool --tool=forktail --no-prompt
      git mergetool --tool=forktail

      mergetool.forktail.trustExitCode remains false because closing the GUI does not report save success through a reliable process exit code.",
      }
    `);
    expect(config.difftool).toContain("C:/Program Files/Forktail O");
    expect(config.difftool).not.toContain("C:\\Program Files");
  });

  it("snapshots Linux config independently", () => {
    const config = generateGitToolConfig("linux", "/opt/Forktail 한글/forktail");

    expect(config).toMatchInlineSnapshot(`
      {
        "difftool": "[difftool "forktail"]
      \tcmd = "forktail_local=\\"$LOCAL\\"; if test \\"$forktail_local\\" = /dev/null; then forktail_local=; fi; forktail_remote=\\"$REMOTE\\"; if test \\"$forktail_remote\\" = /dev/null; then forktail_remote=; fi; exec '/opt/Forktail 한글/forktail' --difftool \\"$forktail_local\\" \\"$forktail_remote\\""",
        "mergetool": "[mergetool "forktail"]
      \tcmd = "forktail_base=\\"$BASE\\"; if test \\"$base_present\\" = false || test \\"$forktail_base\\" = /dev/null; then forktail_base=; fi; exec '/opt/Forktail 한글/forktail' --mergetool \\"$forktail_base\\" \\"$LOCAL\\" \\"$REMOTE\\" \\"$MERGED\\""
      \ttrustExitCode = false
      \thideResolved = false",
        "usage": "Copy either tool-specific snippet into Git config manually.
      Forktail does not modify Git config or change Git's default tools.

      Run Forktail explicitly:
      git difftool --tool=forktail --no-prompt
      git mergetool --tool=forktail

      mergetool.forktail.trustExitCode remains false because closing the GUI does not report save success through a reliable process exit code.",
      }
    `);
  });

  it("accepts safe Windows UNC executable paths", () => {
    const config = generateGitToolConfig(
      "windows",
      "\\\\build-server\\shared apps\\Forktail\\forktail.exe",
    );

    expect(config.difftool).toContain("'//build-server/shared apps/Forktail/forktail.exe'");
    expect(config.mergetool).toContain("'//build-server/shared apps/Forktail/forktail.exe'");
  });

  it("emits only explicit tool-specific config and the documented Git variables", () => {
    for (const [platform, path] of platformPaths) {
      const { difftool, mergetool, usage } = generateGitToolConfig(platform, path);
      const generated = `${difftool}\n${mergetool}\n${usage}`;

      expect(difftool).toContain('[difftool "forktail"]');
      expect(difftool).toContain("--difftool");
      expect(difftool).toContain("$LOCAL");
      expect(difftool).toContain("$REMOTE");
      expect(difftool).toContain("/dev/null");
      expect(difftool).toContain("exec ");

      expect(mergetool).toContain('[mergetool "forktail"]');
      expect(mergetool).toContain("--mergetool");
      expect(mergetool).toContain("$BASE");
      expect(mergetool).toContain("$LOCAL");
      expect(mergetool).toContain("$REMOTE");
      expect(mergetool).toContain("$MERGED");
      expect(mergetool).toContain("/dev/null");
      expect(mergetool).toContain("trustExitCode = false");
      expect(mergetool).toContain("hideResolved = false");
      expect(mergetool).toContain("exec ");

      expect(usage).toContain("git difftool --tool=forktail --no-prompt");
      expect(usage).toContain("git mergetool --tool=forktail");
      expect(usage).toContain("does not modify Git config");
      expect(usage).toContain("trustExitCode remains false");

      expect(generated).not.toMatch(/\[(?:diff|merge)\]/);
      expect(generated).not.toMatch(/\b(?:diff|merge)\.tool\b/);
      expect(generated).not.toMatch(/%[OABP]/);
    }
  });

  it("escapes git-config double quotes and shell-sensitive path characters without interpolation", () => {
    const { difftool } = generateGitToolConfig(
      "linux",
      "/opt/$HOME `touch owned` \"quoted\";still-one-path/forktail",
    );

    expect(difftool).toContain(
      "'/opt/$HOME `touch owned` \\\"quoted\\\";still-one-path/forktail'",
    );
    expect(difftool).not.toContain('exec /opt/$HOME');
  });

  it("rejects empty, relative, control-bearing, and config-injection paths", () => {
    const invalidPaths: ReadonlyArray<readonly [GitToolPlatform, string]> = [
      ["macos", ""],
      ["macos", "   "],
      ["macos", "Applications/Forktail.app/forktail"],
      ["linux", "./forktail"],
      ["linux", "/opt/forktail\0owned"],
      ["linux", "/opt/forktail\towned"],
      ["linux", "/opt/forktail\u0085owned"],
      ["linux", "/opt/forktail\n[core]\n\teditor = owned"],
      ["windows", "forktail.exe"],
      ["windows", "C:relative\\forktail.exe"],
      ["windows", "\\rooted-without-drive\\forktail.exe"],
      ["windows", "\\\\?\\C:\\Forktail\\forktail.exe"],
      ["windows", "\\\\server-only"],
    ];

    for (const [platform, path] of invalidPaths) {
      expect(
        () => generateGitToolConfig(platform, path),
        `${platform}: ${JSON.stringify(path)}`,
      ).toThrow("Invalid Git tool executable path.");
    }
  });
});

const platformPaths: ReadonlyArray<readonly [GitToolPlatform, string]> = [
  ["windows", "C:\\Program Files\\Forktail\\forktail.exe"],
  ["macos", "/Applications/Forktail.app/Contents/MacOS/forktail"],
  ["linux", "/opt/forktail/forktail"],
];
