/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rustFilesCommand = readFileSync(new URL("../../src-tauri/src/commands/files.rs", import.meta.url), "utf8");
const rustTextCore = readFileSync(new URL("../../src-tauri/src/text.rs", import.meta.url), "utf8");
const architecture = readFileSync(new URL("../../docs/02_ARCHITECTURE.md", import.meta.url), "utf8");
const adr = readFileSync(new URL("../../docs/10_ADR.md", import.meta.url), "utf8");

describe("large text strategy", () => {
  it("keeps Phase 1 on the documented 64 MiB safety cap", () => {
    expect(rustTextCore).toContain("pub const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;");
    expect(rustFilesCommand).toContain("const MAX_TEXT_FILE_BYTES: u64 = MAX_TEXT_BYTES;");
    expect(rustFilesCommand).toContain("metadata.len() > MAX_TEXT_FILE_BYTES");
    expect(rustFilesCommand).toContain("AppErrorCode::TooLarge");
    expect(rustFilesCommand).toContain("대용량 파일 모드는 후속 작업");

    expect(architecture).toContain("Phase 1은 64 MiB 이하 파일을 메모리에 올린다");
    expect(architecture).toContain("대용량 모드는 별도 설계 없이 한도를 올리지 않는다");

    expect(adr).toContain("ADR-008: Phase 1 대용량 텍스트 전략은 64 MiB 안전 한도");
    expect(adr).toContain("metadata size를 먼저 확인");
    expect(adr).toContain("Streaming diff는 Phase 1 범위에 넣지 않고");
  });
});
