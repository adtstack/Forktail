#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const requiredNodeMajor = 22;
const requiredTools = [
  {
    name: "Node.js",
    command: process.execPath,
    args: ["--version"],
    parse: (output) => output.replace(/^v/, ""),
    check: (version) => Number.parseInt(version.split(".")[0] ?? "0", 10) >= requiredNodeMajor,
    hint: `Node.js ${requiredNodeMajor} 이상을 사용하세요.`,
  },
  {
    name: "npm",
    command: "npm",
    args: ["--version"],
    parse: (output) => output,
    check: (version) => version.length > 0,
    hint: "Node.js 설치에 포함된 npm이 PATH에 있어야 합니다.",
  },
  {
    name: "rustc",
    command: "rustc",
    args: ["--version"],
    parse: parseRustVersion,
    check: (version) => version.length > 0,
    hint: "Rust stable toolchain을 설치하세요. rustup 사용을 권장합니다.",
  },
  {
    name: "cargo",
    command: "cargo",
    args: ["--version"],
    parse: parseRustVersion,
    check: (version) => version.length > 0,
    hint: "Cargo가 PATH에 있어야 Rust/Tauri 검증을 실행할 수 있습니다.",
  },
  {
    name: "rustfmt",
    command: "rustfmt",
    args: ["--version"],
    parse: parseRustVersion,
    check: (version) => version.length > 0,
    hint: "rustfmt component를 설치하세요.",
  },
  {
    name: "cargo clippy",
    command: "cargo",
    args: ["clippy", "--version"],
    parse: parseRustVersion,
    check: (version) => version.length > 0,
    hint: "clippy component를 설치하세요.",
  },
  {
    name: "Tauri CLI executable",
    command: "npm",
    args: ["exec", "--offline", "tauri", "--", "--version"],
    parse: parseTauriVersion,
    check: (version) => version.length > 0,
    hint: "npm ci를 실행해 lockfile에 고정된 @tauri-apps/cli를 설치하세요.",
  },
];

const tauriCliVersion = require("../package.json").devDependencies["@tauri-apps/cli"];
const results = [
  ...requiredTools.map(checkTool),
  {
    name: "@tauri-apps/cli",
    ok: Boolean(tauriCliVersion),
    version: tauriCliVersion ?? null,
    message: tauriCliVersion
      ? `package.json devDependency ${tauriCliVersion}`
      : "package.json에 @tauri-apps/cli devDependency가 없습니다.",
    hint: "Tauri CLI는 lockfile로 고정된 npm devDependency로 관리합니다.",
  },
];

const failed = results.filter((result) => !result.ok);

for (const result of results) {
  const mark = result.ok ? "OK" : "MISSING";
  const version = result.version ? ` ${result.version}` : "";
  console.log(`[${mark}] ${result.name}${version}`);
  if (!result.ok) {
    console.log(`  ${result.message}`);
    console.log(`  ${result.hint}`);
  }
}

if (failed.length > 0) {
  console.log("");
  console.log("forktail desktop 실행 전 필요한 도구가 빠져 있습니다.");
  console.log("설치 후 다시 실행할 명령:");
  console.log("  npm run doctor");
  console.log("  npm run check");
  console.log("  npm run tauri dev");
  process.exitCode = 1;
}

function checkTool(tool) {
  const result = spawnSync(tool.command, tool.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    return {
      name: tool.name,
      ok: false,
      version: null,
      message: result.error.code === "ENOENT"
        ? `${tool.command} 명령을 찾을 수 없습니다.`
        : result.error.message,
      hint: tool.hint,
    };
  }

  const output = `${result.stdout}${result.stderr}`.trim();
  const version = tool.parse(output);
  const ok = result.status === 0 && tool.check(version);

  return {
    name: tool.name,
    ok,
    version: version || null,
    message: ok ? output : output || `${tool.command} 실행에 실패했습니다.`,
    hint: tool.hint,
  };
}

function parseRustVersion(output) {
  const match = output.match(/\b\d+\.\d+\.\d+\b/);
  return match?.[0] ?? "";
}

function parseTauriVersion(output) {
  const match = output.match(/\b\d+\.\d+\.\d+\b/);
  return match?.[0] ?? "";
}
