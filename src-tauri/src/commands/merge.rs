use crate::domain::models::MergeResult;
use crate::error::CommandResult;

#[tauri::command]
pub fn merge_texts(base: String, ours: String, theirs: String) -> CommandResult<MergeResult> {
    let (output, clean) = match diffy::merge(&base, &ours, &theirs) {
        Ok(output) => (output, true),
        Err(output_with_conflicts) => (output_with_conflicts, false),
    };
    let conflict_count = count_conflicts(&output);

    Ok(MergeResult {
        output,
        clean,
        conflict_count,
    })
}

fn count_conflicts(text: &str) -> usize {
    text.lines()
        .filter(|line| line.trim_end_matches('\r') == "<<<<<<< ours")
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
