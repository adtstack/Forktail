/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const monacoSource = readFileSync(new URL("../monaco.ts", import.meta.url), "utf8");
const fileCompareSource = readFileSync(
  new URL("../components/FileCompareView.tsx", import.meta.url),
  "utf8",
);
const mergeSource = readFileSync(new URL("../components/MergeView.tsx", import.meta.url), "utf8");

describe("Monaco loading policy", () => {
  it("keeps language contributions behind on-demand imports", () => {
    expect(monacoSource).toContain("export function loadMonacoLanguage");
    expect(monacoSource).toContain(
      'typescript: () => import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js")',
    );
    expect(monacoSource).toContain(
      'json: () => import("monaco-editor/esm/vs/language/json/monaco.contribution.js")',
    );
    expect(monacoSource).not.toMatch(/^import "monaco-editor\/esm\/vs\/basic-languages/m);
    expect(monacoSource).not.toMatch(/^import "monaco-editor\/esm\/vs\/language\/json/m);
  });

  it("does not eagerly bundle language service workers", () => {
    expect(monacoSource).toContain(
      'import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"',
    );
    expect(monacoSource).toContain(
      'import("monaco-editor/esm/vs/language/typescript/ts.worker?worker")',
    );
    expect(monacoSource).toContain(
      'import("monaco-editor/esm/vs/language/css/css.worker?worker")',
    );
    expect(monacoSource).not.toMatch(/^import .*Worker from "monaco-editor\/esm\/vs\/language/m);
  });

  it("loads the detected language from both editor screens", () => {
    for (const source of [fileCompareSource, mergeSource]) {
      expect(source).toContain('import { loadMonacoLanguage } from "../monaco"');
      expect(source).toContain("void loadMonacoLanguage(language).then");
      expect(source).toContain('setEditorLanguage(language === "plaintext" ? language : "plaintext")');
    }
  });
});
