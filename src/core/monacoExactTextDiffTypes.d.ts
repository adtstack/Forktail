declare module "monaco-editor/esm/vs/editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.js" {
  interface InternalLineRange {
    startLineNumber: number;
    endLineNumberExclusive: number;
  }

  interface InternalLineChange {
    original: InternalLineRange;
    modified: InternalLineRange;
  }

  interface InternalLinesDiff {
    changes: InternalLineChange[];
    hitTimeout: boolean;
  }

  export class DefaultLinesDiffComputer {
    computeDiff(
      originalLines: string[],
      modifiedLines: string[],
      options: {
        computeMoves: boolean;
        extendToSubwords: boolean;
        ignoreTrimWhitespace: boolean;
        maxComputationTimeMs: number;
      },
    ): InternalLinesDiff;
  }
}
