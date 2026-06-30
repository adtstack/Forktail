#!/usr/bin/env node

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const jsonOnly = process.argv.includes("--json");
const root = mkdtempSync(join(tmpdir(), "forktail-rtm-001-"));

const paths = {
  twoWayLeft: join(root, "two-way", "left.txt"),
  twoWayRight: join(root, "two-way", "right.txt"),
  folderLeft: join(root, "folders", "left"),
  folderRight: join(root, "folders", "right"),
  mergeBase: join(root, "merge", "base.txt"),
  mergeOurs: join(root, "merge", "ours.txt"),
  mergeTheirs: join(root, "merge", "theirs.txt"),
  outputDir: join(root, "output"),
};

mkdirSync(join(root, "two-way"), { recursive: true });
mkdirSync(join(paths.folderLeft, "nested"), { recursive: true });
mkdirSync(join(paths.folderRight, "nested"), { recursive: true });
mkdirSync(join(paths.folderLeft, "type-mismatch"), { recursive: true });
mkdirSync(join(root, "merge"), { recursive: true });
mkdirSync(paths.outputDir, { recursive: true });

writeFileSync(
  paths.twoWayLeft,
  [
    "title: forktail runtime smoke",
    "mode: left",
    "shared: same line",
    "numbers: 1 2 3",
    "",
  ].join("\n"),
);
writeFileSync(
  paths.twoWayRight,
  [
    "title: forktail runtime smoke",
    "mode: right",
    "shared: same line",
    "numbers: 1 2 3 4",
  ].join("\n"),
);

writeFileSync(join(paths.folderLeft, "same.txt"), "same\n");
writeFileSync(join(paths.folderRight, "same.txt"), "same\n");
writeFileSync(join(paths.folderLeft, "changed.txt"), "left version\n");
writeFileSync(join(paths.folderRight, "changed.txt"), "right version\n");
writeFileSync(join(paths.folderLeft, "only-left.txt"), "left only\n");
writeFileSync(join(paths.folderRight, "only-right.txt"), "right only\n");
writeFileSync(join(paths.folderLeft, "nested", "alpha.txt"), "nested left\n");
writeFileSync(join(paths.folderRight, "nested", "alpha.txt"), "nested right\n");
writeFileSync(join(paths.folderRight, "type-mismatch"), "file where left has directory\n");

writeFileSync(
  paths.mergeBase,
  [
    "function greet(name) {",
    "  return `Hello, ${name}`;",
    "}",
    "",
    "function signoff() {",
    "  return \"Goodbye\";",
    "}",
    "",
  ].join("\n"),
);
writeFileSync(
  paths.mergeOurs,
  [
    "function greet(name) {",
    "  const safeName = name.trim();",
    "  return `Hello, ${safeName}`;",
    "}",
    "",
    "function signoff() {",
    "  return \"Goodbye\";",
    "}",
    "",
  ].join("\n"),
);
writeFileSync(
  paths.mergeTheirs,
  [
    "function greet(name, excited = false) {",
    "  const message = `Hello, ${name}`;",
    "  return excited ? `${message}!` : message;",
    "}",
    "",
    "function signoff() {",
    "  return \"Goodbye\";",
    "}",
    "",
  ].join("\n"),
);

const manifest = {
  issue: "RTM-001",
  createdAt: new Date().toISOString(),
  root,
  paths,
  expected: {
    twoWay: "At least 2 changed hunks and a no-final-newline signal on the right file.",
    folder: "same, different, left-only, right-only, and type-mismatch rows are visible.",
    merge: "The greet function produces one conflict and can be saved with backup metadata.",
  },
};

writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

if (jsonOnly) {
  console.log(JSON.stringify(manifest, null, 2));
} else {
  console.log(`RTM-001 smoke fixtures: ${root}`);
  console.log("");
  console.log("Use these paths in the Tauri app:");
  console.log(`  2-way left:    ${paths.twoWayLeft}`);
  console.log(`  2-way right:   ${paths.twoWayRight}`);
  console.log(`  folder left:   ${paths.folderLeft}`);
  console.log(`  folder right:  ${paths.folderRight}`);
  console.log(`  merge base:    ${paths.mergeBase}`);
  console.log(`  merge ours:    ${paths.mergeOurs}`);
  console.log(`  merge theirs:  ${paths.mergeTheirs}`);
  console.log(`  output dir:    ${paths.outputDir}`);
  console.log("");
  console.log(`Manifest: ${join(root, "manifest.json")}`);
}
