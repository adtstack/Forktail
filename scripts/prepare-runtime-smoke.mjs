#!/usr/bin/env node

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);

// Mode: --verify <savedPath> [--expect-changed-from <originalPath>]
// Validates that a file was actually written and (optionally) that a backup exists.
const verifyIdx = args.indexOf("--verify");
if (verifyIdx !== -1) {
  const savedPath = args[verifyIdx + 1];
  if (!savedPath) {
    console.error("[smoke:verify] missing <savedPath> argument after --verify");
    process.exit(2);
  }
  runVerify(savedPath, args);
} else {
  runPrepare(args);
}

/**
 * Prepare RTM-001 smoke fixtures in a temp directory.
 * Generates:
 *   - two-way/left.txt, two-way/right.txt
 *   - folders/{left,right} with same/different/leftOnly/rightOnly/typeMismatch/nested
 *   - merge/{base,ours,theirs}.txt
 *   - output/                (empty, where Save As targets go)
 *   - manifest.json          (paths + expected signals)
 *   - RUNTIME_SMOKE_CHECKLIST.md (manual checklist for the human running the smoke)
 */
function runPrepare(cliArgs) {
  const jsonOnly = cliArgs.includes("--json");
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
    verify: {
      command: "npm run smoke:runtime:verify -- <savedPath> [--expect-changed-from <originalPath>]",
      purpose:
        "After Save/Save As in the Tauri app, confirm the target file was actually written and (when the original path is provided) that a .bak backup was created next to it.",
    },
  };

  writeFileSync(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  writeFileSync(join(root, "RUNTIME_SMOKE_CHECKLIST.md"), buildChecklist(root, paths));

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
    console.log(`Manifest:   ${join(root, "manifest.json")}`);
    console.log(`Checklist:  ${join(root, "RUNTIME_SMOKE_CHECKLIST.md")}`);
    console.log("");
    console.log("After Save/Save As, verify the file landed on disk:");
    console.log("  npm run smoke:runtime:verify -- <savedPath>");
    console.log("  npm run smoke:runtime:verify -- <savedPath> --expect-changed-from <originalPath>");
  }
}

/**
 * Verify that a saved file actually exists on disk and contains the expected content.
 * Optional: when --expect-changed-from <originalPath> is given, also check that
 * the target differs from the original and that a .bak.<timestamp> backup exists
 * in the same directory (forktail writes backups as <name>.bak.<epoch_ms>).
 *
 * Exits 0 on success, 1 on verification failure, 2 on usage error.
 */
function runVerify(savedPath, cliArgs) {
  const expectFromIdx = cliArgs.indexOf("--expect-changed-from");
  const originalPath = expectFromIdx !== -1 ? cliArgs[expectFromIdx + 1] : null;

  const failures = [];

  // 1. The saved file must exist.
  if (!existsSync(savedPath)) {
    failures.push(`saved file does not exist: ${savedPath}`);
  } else {
    const st = statSync(savedPath);
    if (!st.isFile()) {
      failures.push(`saved path is not a regular file: ${savedPath}`);
    } else if (st.size === 0) {
      failures.push(`saved file is empty (0 bytes): ${savedPath}`);
    }
  }

  // 2. When the original path is provided, the saved content should differ from it
  //    and a backup should exist in the same directory as the original.
  if (originalPath) {
    if (!existsSync(originalPath)) {
      failures.push(`original file does not exist: ${originalPath}`);
    } else if (existsSync(savedPath)) {
      const originalBytes = readFileSync(originalPath);
      const savedBytes = readFileSync(savedPath);
      if (bufferEquals(originalBytes, savedBytes)) {
        failures.push(
          `saved content is byte-identical to original; expected the file to change after Save: ${savedPath}`,
        );
      }
    }

    // Backup files are <basename>.bak.<epoch_ms> in the same directory as the target.
    // We look in the directory of savedPath (Save As over an existing file writes
    // the backup next to the target, matching write_text_file_atomic).
    const dir = dirname(savedPath);
    const base = basename(savedPath);
    const backupPrefix = `${base}.bak.`;
    let backups = [];
    try {
      backups = readdirSync(dir).filter((name) => name.startsWith(backupPrefix));
    } catch {
      failures.push(`could not read backup directory: ${dir}`);
    }
    if (backups.length === 0) {
      failures.push(
        `no backup found matching ${backupPrefix}<epoch_ms> in ${dir} (expected when overwriting an existing file)`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("[smoke:verify] FAILED");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log("[smoke:verify] OK");
  if (originalPath) {
    console.log(`  saved:   ${savedPath} (content differs from original)`);
    console.log(`  backup:  present next to ${savedPath}`);
  } else {
    console.log(`  saved:   ${savedPath} (exists and non-empty)`);
  }
  process.exit(0);
}

function bufferEquals(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function buildChecklist(root, paths) {
  return `# RTM-001 Runtime Smoke Checklist

Generated: ${new Date().toISOString()}
Fixture root: \`${root}\`

This is a manual smoke checklist. Run it against \`npm run tauri dev\` or a packaged
\`.app\` / NSIS / AppImage build. Record the result for each step in VALIDATION.md
under "RTM-001 Results". Do NOT paste real user file contents, private paths, or
crash dumps — only pass/fail/manual-not-run and a short note.

## Environment (fill in before running)

- Date:
- OS:            (e.g. macOS 15, Windows 11, Ubuntu 24.04)
- Architecture:  (arm64 / x86_64)
- forktail version:  (from package.json or Help → About)
- Build type:    dev | packaged
- Command:       (e.g. \`npm run tauri dev\` or path to .app/.exe/AppImage)

## Steps

### 1. Two-way compare + Save As

- Open \`${paths.twoWayLeft}\` and \`${paths.twoWayRight}\`.
- [ ] At least 2 changed hunks are visible.
- [ ] The right file shows a no-final-newline signal.
- [ ] F7 / Shift+F7 moves between hunks.
- Edit the right side, then Save As into the output directory:
  \`${paths.outputDir}/2way-saved.txt\`
- [ ] Save dialog opens and the file is written.
- Verify the file landed on disk:
  \`\`\`
  npm run smoke:runtime:verify -- ${paths.outputDir}/2way-saved.txt
  \`\`\`
- [ ] \`[smoke:verify] OK\`

### 2. Folder compare

- Open \`${paths.folderLeft}\` and \`${paths.folderRight}\`.
- [ ] Rows are visible for: same, different, left-only, right-only, type-mismatch.
- [ ] Status filter chips show correct counts.
- [ ] Sort by path / status / size / modified time works.
- [ ] Keyboard navigation (arrows + Enter) opens a 2-way compare for a row.

### 3. Three-way merge + Save As

- Open base \`${paths.mergeBase}\`, ours \`${paths.mergeOurs}\`, theirs \`${paths.mergeTheirs}\`.
- [ ] One conflict is shown in the greet function.
- [ ] F8 / Shift+F8 navigates conflicts.
- [ ] OURS / THEIRS / BASE / BOTH resolution works.
- Save As the merged result into the output directory:
  \`${paths.outputDir}/merge-saved.txt\`
- [ ] Save dialog opens and the merged file is written.
- Verify the file landed on disk:
  \`\`\`
  npm run smoke:runtime:verify -- ${paths.outputDir}/merge-saved.txt
  \`\`\`
- [ ] \`[smoke:verify] OK\`

### 4. Save-over-existing produces a backup (run on macOS if accessible)

- Copy \`${paths.twoWayLeft}\` to \`${paths.outputDir}/overwrite-target.txt\`.
- Open it (or Save As onto it), edit, and Save (overwrite).
- Verify a backup was created:
  \`\`\`
  npm run smoke:runtime:verify -- ${paths.outputDir}/overwrite-target.txt --expect-changed-from ${paths.twoWayLeft}
  \`\`\`
- [ ] \`[smoke:verify] OK\` (saved content differs from original AND a \`.bak.<epoch_ms>\` exists).

### 5. OS gestures (mark \`manual-not-run\` if not automatable on this OS)

- [ ] Native menu items (File / Edit / Navigate / Merge) emit their command.
- [ ] Native reveal opens Finder / Explorer / file manager on the selected row.
- [ ] Drag & drop 2 files onto the start page opens a 2-way compare.
- [ ] Drag & drop 1 file onto a pane loads it into that pane.

## Result summary (copy into VALIDATION.md → "RTM-001 Results")

\`\`\`
2-way compare:    pass | fail | manual-not-run
Folder compare:   pass | fail | manual-not-run
3-way merge:      pass | fail | manual-not-run
Save/Save As:     pass | fail | manual-not-run
Backup on save:   pass | fail | manual-not-run
Native menu:      pass | fail | manual-not-run
Native reveal:    pass | fail | manual-not-run
Drag and drop:    pass | fail | manual-not-run
\`\`\`

Notes:
-
`;
}
