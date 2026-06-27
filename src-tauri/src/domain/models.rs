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
    pub is_binary: bool,
    pub decode_had_errors: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub path: String,
    pub size: u64,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
    Mixed,
    None,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderCompareMode {
    Metadata,
    QuickHash,
    FullHash,
}

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntryMeta {
    pub kind: FsEntryKind,
    pub size: u64,
    pub modified_ms: Option<u64>,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Default, Clone, Serialize)]
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
}
