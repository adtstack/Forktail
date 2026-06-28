import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = join(repoRoot, "fixtures", "three-way", "cases");

const lf = (lines) => `${lines.join("\n")}\n`;
const raw = (text) => text;
const conflict = (ours, base, theirs) =>
  `<<<<<<< ours\n${ours}||||||| original\n${base}=======\n${theirs}>>>>>>> theirs\n`;

const cases = [
  cleanCase("non-overlapping-modify-ends", ["non-overlapping-modify"], {
    base: lf(["alpha", "beta", "gamma"]),
    ours: lf(["ALPHA", "beta", "gamma"]),
    theirs: lf(["alpha", "beta", "GAMMA"]),
    expected: lf(["ALPHA", "beta", "GAMMA"]),
  }),
  cleanCase("non-overlapping-insert-and-delete", ["non-overlapping-modify", "insert", "delete"], {
    base: lf(["one", "two", "three", "four"]),
    ours: lf(["zero", "one", "two", "three", "four"]),
    theirs: lf(["one", "two", "four"]),
    expected: lf(["zero", "one", "two", "four"]),
  }),
  cleanCase("same-overlapping-modify", ["same-overlapping-modify"], {
    base: lf(["title", "status: old", "end"]),
    ours: lf(["title", "status: new", "end"]),
    theirs: lf(["title", "status: new", "end"]),
    expected: lf(["title", "status: new", "end"]),
  }),
  conflictCase("different-overlapping-modify", ["different-overlapping-modify"], {
    base: lf(["title", "status: old", "end"]),
    ours: lf(["title", "status: ours", "end"]),
    theirs: lf(["title", "status: theirs", "end"]),
    expected: `title\n${conflict("status: ours\n", "status: old\n", "status: theirs\n")}end\n`,
  }),
  cleanCase("insert-same-position-same-text", ["insert-same-position-same-text", "insert"], {
    base: lf(["before", "after"]),
    ours: lf(["before", "shared", "after"]),
    theirs: lf(["before", "shared", "after"]),
    expected: lf(["before", "shared", "after"]),
  }),
  conflictCase("insert-same-position-different-text", [
    "insert-same-position-different-text",
    "insert",
  ], {
    base: lf(["before", "after"]),
    ours: lf(["before", "ours insert", "after"]),
    theirs: lf(["before", "theirs insert", "after"]),
    expected: `before\n${conflict("ours insert\n", "", "theirs insert\n")}after\n`,
  }),
  cleanCase("delete-vs-untouched", ["delete-vs-untouched", "delete"], {
    base: lf(["keep", "remove", "tail"]),
    ours: lf(["keep", "tail"]),
    theirs: lf(["keep", "remove", "tail"]),
    expected: lf(["keep", "tail"]),
  }),
  conflictCase("delete-vs-modify", ["delete-vs-modify", "delete"], {
    base: lf(["keep", "middle", "tail"]),
    ours: lf(["keep", "tail"]),
    theirs: lf(["keep", "changed middle", "tail"]),
    expected: `keep\n${conflict("", "middle\n", "changed middle\n")}tail\n`,
  }),
  conflictCase("move-like-delete-add", ["move-like-delete-add", "delete", "insert"], {
    base: lf(["a", "move-me", "b", "c"]),
    ours: lf(["a", "b", "c", "move-me"]),
    theirs: lf(["a", "MOVE-ME", "b", "c"]),
    expected: `a\n${conflict("", "move-me\n", "MOVE-ME\n")}b\nc\nmove-me\n`,
  }),
  conflictCase("repeated-lines-ambiguity", ["repeated-lines-ambiguity"], {
    base: lf(["item", "same", "item", "same", "tail"]),
    ours: lf(["item", "same", "OURS", "same", "tail"]),
    theirs: lf(["item", "same", "THEIRS", "same", "tail"]),
    expected: `item\nsame\n${conflict("OURS\n", "item\n", "THEIRS\n")}same\ntail\n`,
  }),
  cleanCase("empty-base-both-add-same", ["empty-base", "insert-same-position-same-text"], {
    base: "",
    ours: lf(["new", "file"]),
    theirs: lf(["new", "file"]),
    expected: lf(["new", "file"]),
  }),
  conflictCase("empty-base-both-add-different", ["empty-base", "insert-same-position-different-text"], {
    base: "",
    ours: lf(["ours new"]),
    theirs: lf(["theirs new"]),
    expected: conflict("ours new\n", "", "theirs new\n"),
  }),
  cleanCase("empty-ours-delete-vs-untouched", ["empty-ours", "delete-vs-untouched"], {
    base: lf(["gone"]),
    ours: "",
    theirs: lf(["gone"]),
    expected: "",
  }),
  cleanCase("empty-theirs-delete-vs-untouched", ["empty-theirs", "delete-vs-untouched"], {
    base: lf(["gone"]),
    ours: lf(["gone"]),
    theirs: "",
    expected: "",
  }),
  cleanCase("crlf-non-overlap", ["crlf", "non-overlapping-modify"], {
    base: raw("a\r\nb\r\nc\r\n"),
    ours: raw("A\r\nb\r\nc\r\n"),
    theirs: raw("a\r\nb\r\nC\r\n"),
    expected: raw("A\r\nb\r\nC\r\n"),
  }),
  cleanCase("no-final-newline-one-side", ["no-final-newline"], {
    base: "a\nb",
    ours: "A\nb",
    theirs: "a\nb",
    expected: "A\nb",
  }),
  cleanCase("marker-like-user-text", ["marker-like-user-text"], {
    base: lf(["literal <<<<<<< ours", "value", "literal >>>>>>> theirs"]),
    ours: lf(["literal <<<<<<< ours", "value ours", "literal >>>>>>> theirs"]),
    theirs: lf(["literal <<<<<<< ours", "value", "literal >>>>>>> theirs"]),
    expected: lf(["literal <<<<<<< ours", "value ours", "literal >>>>>>> theirs"]),
  }),
  conflictCase("multiple-conflicts", ["multiple-conflicts", "different-overlapping-modify"], {
    base: lf(["one", "two", "three", "four", "five"]),
    ours: lf(["ONE", "two", "THREE", "four", "five"]),
    theirs: lf(["uno", "two", "tres", "four", "five"]),
    expected: `${conflict("ONE\n", "one\n", "uno\n")}two\n${conflict("THREE\n", "three\n", "tres\n")}four\nfive\n`,
    conflictCount: 2,
  }),
  conflictCase("conflict-at-first-line", ["conflict-at-first-line", "different-overlapping-modify"], {
    base: lf(["start", "tail"]),
    ours: lf(["ours start", "tail"]),
    theirs: lf(["theirs start", "tail"]),
    expected: `${conflict("ours start\n", "start\n", "theirs start\n")}tail\n`,
  }),
  conflictCase("conflict-at-last-line", ["conflict-at-last-line", "different-overlapping-modify"], {
    base: lf(["head", "last"]),
    ours: lf(["head", "ours last"]),
    theirs: lf(["head", "theirs last"]),
    expected: `head\n${conflict("ours last\n", "last\n", "theirs last\n")}`,
  }),
  conflictCase("unicode-normalization-difference", ["unicode-normalization-difference"], {
    base: lf(["cafe"]),
    ours: lf(["café"]),
    theirs: lf(["cafe\u0301"]),
    expected: conflict("café\n", "cafe\n", "cafe\u0301\n"),
  }),
  cleanCase("both-append-same", ["insert-same-position-same-text", "insert"], {
    base: lf(["base"]),
    ours: lf(["base", "append"]),
    theirs: lf(["base", "append"]),
    expected: lf(["base", "append"]),
  }),
  conflictCase("both-append-different", ["insert-same-position-different-text", "insert"], {
    base: lf(["base"]),
    ours: lf(["base", "ours append"]),
    theirs: lf(["base", "theirs append"]),
    expected: `base\n${conflict("ours append\n", "", "theirs append\n")}`,
  }),
  cleanCase("ours-insert-theirs-modify-nonoverlap", ["non-overlapping-modify", "insert"], {
    base: lf(["one", "two", "three"]),
    ours: lf(["one", "inserted", "two", "three"]),
    theirs: lf(["one", "two", "THREE"]),
    expected: lf(["one", "inserted", "two", "THREE"]),
  }),
  cleanCase("theirs-delete-ours-modify-nonoverlap", ["non-overlapping-modify", "delete"], {
    base: lf(["one", "two", "three", "four"]),
    ours: lf(["ONE", "two", "three", "four"]),
    theirs: lf(["one", "two", "four"]),
    expected: lf(["ONE", "two", "four"]),
  }),
  cleanCase("identical-files", ["same-overlapping-modify"], {
    base: lf(["same", "file"]),
    ours: lf(["same", "file"]),
    theirs: lf(["same", "file"]),
    expected: lf(["same", "file"]),
  }),
  cleanCase("ours-only-full-rewrite", ["delete-vs-untouched", "insert"], {
    base: lf(["old one", "old two"]),
    ours: lf(["new one", "new two"]),
    theirs: lf(["old one", "old two"]),
    expected: lf(["new one", "new two"]),
  }),
  cleanCase("theirs-only-full-rewrite", ["delete-vs-untouched", "insert"], {
    base: lf(["old one", "old two"]),
    ours: lf(["old one", "old two"]),
    theirs: lf(["new one", "new two"]),
    expected: lf(["new one", "new two"]),
  }),
  cleanCase("both-same-delete", ["delete", "delete-vs-untouched"], {
    base: lf(["keep", "drop", "tail"]),
    ours: lf(["keep", "tail"]),
    theirs: lf(["keep", "tail"]),
    expected: lf(["keep", "tail"]),
  }),
  cleanCase("adjacent-nonoverlap", ["non-overlapping-modify"], {
    base: lf(["a", "b", "c", "d"]),
    ours: lf(["A", "b", "c", "d"]),
    theirs: lf(["a", "b", "c", "D"]),
    expected: lf(["A", "b", "c", "D"]),
  }),
  cleanCase("repeated-lines-clean-one-side", ["repeated-lines-ambiguity"], {
    base: lf(["x", "same", "x", "same"]),
    ours: lf(["x", "same", "changed", "same"]),
    theirs: lf(["x", "same", "x", "same"]),
    expected: lf(["x", "same", "changed", "same"]),
  }),
  conflictCase("whitespace-only-conflict", ["different-overlapping-modify"], {
    base: lf(["key=value"]),
    ours: lf(["key = value"]),
    theirs: lf(["key=value "]),
    expected: conflict("key = value\n", "key=value\n", "key=value \n"),
  }),
];

mkdirSync(fixtureRoot, { recursive: true });

for (const testCase of cases) {
  const directory = join(fixtureRoot, testCase.name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "base.txt"), testCase.base);
  writeFileSync(join(directory, "ours.txt"), testCase.ours);
  writeFileSync(join(directory, "theirs.txt"), testCase.theirs);
  writeFileSync(join(directory, "expected.txt"), testCase.expected);
  writeFileSync(
    join(directory, "metadata.json"),
    `${JSON.stringify({
      id: testCase.name,
      categories: testCase.categories,
      clean: testCase.clean,
      conflictCount: testCase.conflictCount,
    }, null, 2)}\n`,
  );
}

console.log(`Wrote ${cases.length} merge fixtures to ${fixtureRoot}`);

function cleanCase(name, categories, data) {
  return {
    name,
    categories,
    clean: true,
    conflictCount: 0,
    ...data,
  };
}

function conflictCase(name, categories, data) {
  return {
    name,
    categories,
    clean: false,
    conflictCount: data.conflictCount ?? 1,
    ...data,
  };
}
