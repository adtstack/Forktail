use crate::domain::models::MergeResult;
use crate::error::CommandResult;

#[tauri::command]
pub fn merge_texts(base: String, ours: String, theirs: String) -> CommandResult<MergeResult> {
    Ok(merge_text_values(&base, &ours, &theirs))
}

pub(crate) fn merge_text_values(base: &str, ours: &str, theirs: &str) -> MergeResult {
    let (output, clean) = match diffy::merge(base, ours, theirs) {
        Ok(output) => (output, true),
        Err(output_with_conflicts) => (output_with_conflicts, false),
    };
    let conflict_count = count_conflicts(&output);

    MergeResult {
        output,
        clean,
        conflict_count,
    }
}

fn count_conflicts(text: &str) -> usize {
    text.lines()
        .filter(|line| line.trim_end_matches('\r') == "<<<<<<< ours")
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::collections::BTreeSet;
    use std::fs;
    use std::path::{Path, PathBuf};

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MergeFixtureMetadata {
        id: String,
        categories: Vec<String>,
        clean: bool,
        conflict_count: usize,
    }

    #[test]
    fn cleanly_merges_non_overlapping_changes() {
        let result = merge_texts("a\nb\nc\n".into(), "A\nb\nc\n".into(), "a\nb\nC\n".into())
            .expect("merge should run");
        assert!(result.clean);
        assert_eq!(result.output, "A\nb\nC\n");
    }

    #[test]
    fn reports_conflicts() {
        let result = merge_texts("a\n".into(), "ours\n".into(), "theirs\n".into())
            .expect("merge should run");
        assert!(!result.clean);
        assert_eq!(result.conflict_count, 1);
    }

    #[test]
    fn conflict_markers_use_stable_phase_one_labels() {
        let result = merge_texts("base\n".into(), "ours\n".into(), "theirs\n".into())
            .expect("merge should run");

        assert!(result.output.contains("<<<<<<< ours\n"));
        assert!(result.output.contains("||||||| original\n"));
        assert!(result.output.contains("=======\n"));
        assert!(result.output.contains(">>>>>>> theirs\n"));
    }

    #[test]
    fn merge_fixture_suite_covers_phase_one_cases() {
        let fixture_root = three_way_fixture_root();
        let cases = fixture_cases(&fixture_root);

        assert!(
            cases.len() >= 30,
            "MRG-001 requires at least 30 merge fixtures, found {}",
            cases.len()
        );

        let mut covered_categories = BTreeSet::new();
        for case_directory in &cases {
            let metadata = fixture_metadata(case_directory);
            for category in metadata.categories {
                covered_categories.insert(category);
            }
        }

        for required in [
            "non-overlapping-modify",
            "same-overlapping-modify",
            "different-overlapping-modify",
            "insert-same-position-same-text",
            "insert-same-position-different-text",
            "delete-vs-untouched",
            "delete-vs-modify",
            "move-like-delete-add",
            "repeated-lines-ambiguity",
            "empty-base",
            "empty-ours",
            "empty-theirs",
            "crlf",
            "no-final-newline",
            "marker-like-user-text",
            "multiple-conflicts",
            "conflict-at-first-line",
            "conflict-at-last-line",
            "unicode-normalization-difference",
        ] {
            assert!(
                covered_categories.contains(required),
                "missing merge fixture category {required}"
            );
        }
    }

    #[test]
    fn merge_fixtures_match_expected_outputs_exactly() {
        for case_directory in fixture_cases(&three_way_fixture_root()) {
            let metadata = fixture_metadata(&case_directory);
            let base = read_fixture_text(&case_directory, "base.txt");
            let ours = read_fixture_text(&case_directory, "ours.txt");
            let theirs = read_fixture_text(&case_directory, "theirs.txt");
            let expected = read_fixture_text(&case_directory, "expected.txt");

            let result = merge_texts(base, ours, theirs).expect("merge should run");

            assert_eq!(
                result.clean, metadata.clean,
                "clean mismatch for {}",
                metadata.id
            );
            assert_eq!(
                result.conflict_count, metadata.conflict_count,
                "conflict count mismatch for {}",
                metadata.id
            );
            assert_eq!(
                result.output, expected,
                "output mismatch for {}",
                metadata.id
            );
        }
    }

    fn three_way_fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/three-way/cases")
    }

    fn fixture_cases(root: &Path) -> Vec<PathBuf> {
        let mut cases = fs::read_dir(root)
            .unwrap_or_else(|error| panic!("read fixture directory {}: {error}", root.display()))
            .map(|entry| entry.expect("read fixture entry").path())
            .filter(|path| path.is_dir())
            .collect::<Vec<_>>();
        cases.sort();
        cases
    }

    fn fixture_metadata(case_directory: &Path) -> MergeFixtureMetadata {
        let text = read_fixture_text(case_directory, "metadata.json");
        serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("parse metadata {}: {error}", case_directory.display()))
    }

    fn read_fixture_text(case_directory: &Path, file_name: &str) -> String {
        let path = case_directory.join(file_name);
        fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read fixture file {}: {error}", path.display()))
    }
}
