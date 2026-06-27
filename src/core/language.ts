const extensionToLanguage: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "cpp",
  hpp: "cpp",
  html: "html",
  htm: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  md: "markdown",
  markdown: "markdown",
  php: "php",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sass: "scss",
  scss: "scss",
  sh: "shell",
  sql: "sql",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  vue: "html",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

export function languageFromPath(path: string): string {
  const filename = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (filename === "dockerfile") return "dockerfile";
  if (filename === "makefile") return "makefile";
  const extension = filename.includes(".") ? filename.split(".").pop() ?? "" : "";
  return extensionToLanguage[extension] ?? "plaintext";
}
