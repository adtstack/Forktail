import { loader } from "@monaco-editor/react";
import "monaco-editor/esm/vs/editor/editor.all.js";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

type MonacoContributionLoader = () => Promise<unknown>;

const languageContributionLoaders: Record<string, MonacoContributionLoader> = {
  c: () => import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js"),
  cpp: () => import("monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js"),
  csharp: () => import("monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js"),
  css: () => import("monaco-editor/esm/vs/basic-languages/css/css.contribution.js"),
  dockerfile: () => import("monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js"),
  go: () => import("monaco-editor/esm/vs/basic-languages/go/go.contribution.js"),
  html: () => import("monaco-editor/esm/vs/basic-languages/html/html.contribution.js"),
  ini: () => import("monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js"),
  java: () => import("monaco-editor/esm/vs/basic-languages/java/java.contribution.js"),
  javascript: () => import("monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js"),
  json: () => import("monaco-editor/esm/vs/language/json/monaco.contribution.js"),
  kotlin: () => import("monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js"),
  less: () => import("monaco-editor/esm/vs/basic-languages/less/less.contribution.js"),
  lua: () => import("monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js"),
  markdown: () => import("monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js"),
  php: () => import("monaco-editor/esm/vs/basic-languages/php/php.contribution.js"),
  powershell: () => import("monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution.js"),
  python: () => import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js"),
  ruby: () => import("monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js"),
  rust: () => import("monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js"),
  scss: () => import("monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js"),
  shell: () => import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js"),
  sql: () => import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js"),
  swift: () => import("monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js"),
  typescript: () => import("monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js"),
  xml: () => import("monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js"),
  yaml: () => import("monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js"),
};

const loadedLanguageContributions = new Map<string, Promise<unknown>>();

export function loadMonacoLanguage(language: string): Promise<unknown> {
  const loader = languageContributionLoaders[language];
  if (!loader) return Promise.resolve();

  const existing = loadedLanguageContributions.get(language);
  if (existing) return existing;

  const pending = loader();
  loadedLanguageContributions.set(language, pending);
  return pending;
}

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") {
      return import("monaco-editor/esm/vs/language/json/json.worker?worker").then(
        ({ default: JsonWorker }) => new JsonWorker(),
      );
    }
    if (label === "css" || label === "scss" || label === "less") {
      return import("monaco-editor/esm/vs/language/css/css.worker?worker").then(
        ({ default: CssWorker }) => new CssWorker(),
      );
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return import("monaco-editor/esm/vs/language/html/html.worker?worker").then(
        ({ default: HtmlWorker }) => new HtmlWorker(),
      );
    }
    if (label === "typescript" || label === "javascript") {
      return import("monaco-editor/esm/vs/language/typescript/ts.worker?worker").then(
        ({ default: TsWorker }) => new TsWorker(),
      );
    }
    return new EditorWorker();
  },
};

loader.config({ monaco });
