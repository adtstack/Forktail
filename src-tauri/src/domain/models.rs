use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDocument {
    pub path: String,
    pub name: String,
    pub text: String,
    pub encoding: String,
    pub line_ending: LineEnding,
    pub had_final_newline: bool,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub content_hash: String,
    pub is_binary: bool,
    pub decode_had_errors: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub path: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileBackup {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
    Mixed,
    None,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderCompareMode {
    Metadata,
    QuickHash,
    FullHash,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScanOptions {
    pub compare_mode: FolderCompareMode,
    pub include_hidden: bool,
    pub respect_gitignore: bool,
    pub follow_symlinks: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FsEntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsEntryMeta {
    pub kind: FsEntryKind,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FolderEntryStatus {
    Same,
    Different,
    LeftOnly,
    RightOnly,
    TypeMismatch,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub relative_path: String,
    pub left_path: Option<String>,
    pub right_path: Option<String>,
    pub left: Option<FsEntryMeta>,
    pub right: Option<FsEntryMeta>,
    pub status: FolderEntryStatus,
    pub message: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderScanStats {
    pub same: usize,
    pub different: usize,
    pub left_only: usize,
    pub right_only: usize,
    pub type_mismatch: usize,
    pub errors: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScanResult {
    pub left_root: String,
    pub right_root: String,
    pub entries: Vec<FolderEntry>,
    pub stats: FolderScanStats,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartFolderScanRequest {
    pub scan_generation: u64,
    pub left_root: String,
    pub right_root: String,
    pub options: FolderScanOptions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScanStarted {
    pub job_id: u64,
    pub scan_generation: u64,
    pub left_root: String,
    pub right_root: String,
    pub options_fingerprint: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScanAck {
    pub job_id: u64,
    pub scan_generation: u64,
    pub applied_through_sequence: u64,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PendingReason {
    AwaitingPeer,
    AwaitingHash,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FolderEntryResolution {
    Pending { reason: PendingReason },
    Final { status: FolderEntryStatus },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntryUpsert {
    pub relative_path: String,
    pub revision: u64,
    pub left_path: Option<String>,
    pub right_path: Option<String>,
    pub left: Option<FsEntryMeta>,
    pub right: Option<FsEntryMeta>,
    pub resolution: FolderEntryResolution,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderScanBatch {
    pub upserts: Vec<FolderEntryUpsert>,
    pub estimated_bytes: usize,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FolderScanPhase {
    Inventory,
    Classify,
    Hash,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderScanProgressSnapshot {
    pub phase: FolderScanPhase,
    pub discovered: usize,
    pub finalized: usize,
    pub pending: usize,
    pub errors: usize,
    pub hashed_files: usize,
    pub hash_candidates: Option<usize>,
}

impl Default for FolderScanProgressSnapshot {
    fn default() -> Self {
        Self {
            phase: FolderScanPhase::Inventory,
            discovered: 0,
            finalized: 0,
            pending: 0,
            errors: 0,
            hashed_files: 0,
            hash_candidates: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FolderScanTerminal {
    Completed {
        stats: FolderScanStats,
        entry_count: usize,
        duration_ms: u128,
    },
    Cancelled {
        finalized: usize,
        pending: usize,
        duration_ms: u128,
    },
    Failed {
        code: String,
        message: String,
        finalized: usize,
        pending: usize,
        duration_ms: u128,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum FolderScanMessagePayload {
    Batch(FolderScanBatch),
    Progress(FolderScanProgressSnapshot),
    Terminal(FolderScanTerminal),
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderScanMessage {
    pub job_id: u64,
    pub scan_generation: u64,
    pub sequence: u64,
    #[serde(flatten)]
    pub payload: FolderScanMessagePayload,
}

#[derive(Debug, Clone, Copy, Deserialize, Hash, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderReviewSideExpectation {
    RegularFile,
    Missing,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderReviewTextPairRequest {
    pub left_root: String,
    pub right_root: String,
    pub relative_path: String,
    pub left_expected: FolderReviewSideExpectation,
    pub right_expected: FolderReviewSideExpectation,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderReviewTextPair {
    pub left: Option<FileDocument>,
    pub right: Option<FileDocument>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenDetachedFolderReviewRequest {
    pub source_review_token: String,
    pub scan_generation: u64,
    pub left_root: String,
    pub right_root: String,
    pub relative_path: String,
    pub left_expected: FolderReviewSideExpectation,
    pub right_expected: FolderReviewSideExpectation,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DetachedFolderReviewOpenResult {
    Created { window_label: String },
    Focused { window_label: String },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvalidateDetachedFolderReviewSource {
    pub source_review_token: String,
    pub scan_generation: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetachedFolderReviewContext {
    pub file_name: String,
    pub parent_relative_path: String,
    pub relative_path: String,
    pub left_root: String,
    pub right_root: String,
    pub left_missing: bool,
    pub right_missing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedFolderReviewLoaded {
    pub context: DetachedFolderReviewContext,
    pub left: Option<FileDocument>,
    pub right: Option<FileDocument>,
    pub model_identity: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetachedFolderReviewVersionCheck {
    pub left_changed: bool,
    pub right_changed: bool,
    pub version_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub output: String,
    pub clean: bool,
    pub conflict_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    pub backup_path: Option<String>,
    pub bytes_written: usize,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub content_hash: String,
}

#[cfg(test)]
mod progressive_folder_scan_contract_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn progressive_batch_uses_flat_identity_and_camel_case_contract() {
        let message = FolderScanMessage {
            job_id: 17,
            scan_generation: 4,
            sequence: 2,
            payload: FolderScanMessagePayload::Batch(FolderScanBatch {
                upserts: vec![FolderEntryUpsert {
                    relative_path: "src/main.rs".to_string(),
                    revision: 1,
                    left_path: Some("/left/src/main.rs".to_string()),
                    right_path: None,
                    left: Some(FsEntryMeta {
                        kind: FsEntryKind::File,
                        size: 12,
                        modified_ms: Some(1_000),
                        hash: None,
                    }),
                    right: None,
                    resolution: FolderEntryResolution::Pending {
                        reason: PendingReason::AwaitingPeer,
                    },
                    message: None,
                }],
                estimated_bytes: 256,
            }),
        };

        let value = serde_json::to_value(message).expect("serialize progressive batch");
        assert_eq!(value["event"], "batch");
        assert_eq!(value["jobId"], 17);
        assert_eq!(value["scanGeneration"], 4);
        assert_eq!(value["sequence"], 2);
        assert_eq!(value["data"]["upserts"][0]["relativePath"], "src/main.rs");
        assert_eq!(
            value["data"]["upserts"][0]["resolution"],
            json!({ "state": "pending", "reason": "awaitingPeer" })
        );
    }

    #[test]
    fn progressive_terminal_does_not_embed_the_full_row_array() {
        let message = FolderScanMessage {
            job_id: 17,
            scan_generation: 4,
            sequence: 9,
            payload: FolderScanMessagePayload::Terminal(FolderScanTerminal::Completed {
                stats: FolderScanStats {
                    same: 1,
                    ..FolderScanStats::default()
                },
                entry_count: 1,
                duration_ms: 8,
            }),
        };

        let value = serde_json::to_value(message).expect("serialize terminal");
        assert_eq!(value["event"], "terminal");
        assert_eq!(value["data"]["outcome"], "completed");
        assert_eq!(value["data"]["entryCount"], 1);
        assert!(value["data"].get("entries").is_none());
    }
}

#[cfg(test)]
mod detached_folder_review_contract_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detached_open_request_deserializes_camel_case_without_a_child_selector() {
        let request: OpenDetachedFolderReviewRequest = serde_json::from_value(json!({
            "sourceReviewToken": "review-7",
            "scanGeneration": 11,
            "leftRoot": "/left",
            "rightRoot": "/right",
            "relativePath": "src/main.rs",
            "leftExpected": "regularFile",
            "rightExpected": "missing"
        }))
        .expect("deserialize detached open request");

        assert_eq!(request.source_review_token, "review-7");
        assert_eq!(request.scan_generation, 11);
        assert_eq!(request.relative_path, "src/main.rs");
        assert_eq!(request.right_expected, FolderReviewSideExpectation::Missing);
    }

    #[test]
    fn detached_results_serialize_stable_path_free_control_fields() {
        let open = DetachedFolderReviewOpenResult::Created {
            window_label: "folder-review-42".to_string(),
        };
        let loaded = DetachedFolderReviewLoaded {
            context: DetachedFolderReviewContext {
                file_name: "main.rs".to_string(),
                parent_relative_path: "src".to_string(),
                relative_path: "src/main.rs".to_string(),
                left_root: "/left".to_string(),
                right_root: "/right".to_string(),
                left_missing: false,
                right_missing: true,
            },
            left: None,
            right: None,
            model_identity: "detached-model-42".to_string(),
        };
        let versions = DetachedFolderReviewVersionCheck {
            left_changed: false,
            right_changed: true,
            version_key: "left:same|right:changed".to_string(),
        };

        assert_eq!(
            serde_json::to_value(open).expect("serialize open result"),
            json!({ "outcome": "created", "windowLabel": "folder-review-42" })
        );
        let loaded_value = serde_json::to_value(loaded).expect("serialize loaded result");
        assert_eq!(loaded_value["context"]["parentRelativePath"], "src");
        assert_eq!(loaded_value["modelIdentity"], "detached-model-42");
        assert!(loaded_value.get("sourceReviewToken").is_none());
        assert_eq!(
            serde_json::to_value(versions).expect("serialize version check"),
            json!({
                "leftChanged": false,
                "rightChanged": true,
                "versionKey": "left:same|right:changed"
            })
        );
    }
}
