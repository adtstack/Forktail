use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GitObjectAlgorithm {
    Sha1,
    Sha256,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitObjectIdError {
    InvalidLength {
        algorithm: GitObjectAlgorithm,
        expected: usize,
        actual: usize,
    },
    InvalidUnknownLength {
        actual: usize,
    },
    InvalidHex,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitObjectId {
    pub algorithm: GitObjectAlgorithm,
    pub hex: String,
}

impl<'de> Deserialize<'de> for GitObjectId {
    fn deserialize<DeserializerType>(
        deserializer: DeserializerType,
    ) -> Result<Self, DeserializerType::Error>
    where
        DeserializerType: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct WireObjectId {
            algorithm: GitObjectAlgorithm,
            hex: String,
        }

        let wire = WireObjectId::deserialize(deserializer)?;
        Self::try_new(wire.algorithm, wire.hex)
            .map_err(|_| serde::de::Error::custom("invalid full Git object ID"))
    }
}

impl GitObjectId {
    pub fn try_new(
        algorithm: GitObjectAlgorithm,
        hex: impl Into<String>,
    ) -> Result<Self, GitObjectIdError> {
        let mut hex = hex.into();
        let actual = hex.len();
        match algorithm {
            GitObjectAlgorithm::Sha1 if actual != 40 => {
                return Err(GitObjectIdError::InvalidLength {
                    algorithm,
                    expected: 40,
                    actual,
                });
            }
            GitObjectAlgorithm::Sha256 if actual != 64 => {
                return Err(GitObjectIdError::InvalidLength {
                    algorithm,
                    expected: 64,
                    actual,
                });
            }
            GitObjectAlgorithm::Unknown if actual == 0 || actual % 2 != 0 => {
                return Err(GitObjectIdError::InvalidUnknownLength { actual });
            }
            _ => {}
        }
        if !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(GitObjectIdError::InvalidHex);
        }
        hex.make_ascii_lowercase();
        Ok(Self { algorithm, hex })
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPathIdentity {
    pub opaque_id: String,
    pub display_path: String,
    pub utf8_path: Option<String>,
}

impl GitPathIdentity {
    pub fn new<Opaque, Display, Utf8>(
        opaque_id: Opaque,
        display_path: Display,
        utf8_path: Option<Utf8>,
    ) -> Self
    where
        Opaque: Into<String>,
        Display: Into<String>,
        Utf8: Into<String>,
    {
        Self {
            opaque_id: opaque_id.into(),
            display_path: display_path.into(),
            utf8_path: utf8_path.map(Into::into),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitPathPlatform {
    Unix,
    Windows,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitPathRegistryError {
    EmptyPath,
    PathContainsNul,
    DuplicateOpaqueId,
    UnknownOpaqueId,
    StaleGeneration,
    PlatformConversionUnsupported,
    GenerationExhausted,
    OpaqueIdExhausted,
}

#[derive(Debug)]
pub struct GitPathRegistry {
    session_scope: String,
    generation: u64,
    next_id: u64,
    paths_by_id: HashMap<String, Vec<u8>>,
    ids_by_path: HashMap<Vec<u8>, String>,
}

impl GitPathRegistry {
    pub fn new(session_scope: impl Into<String>) -> Self {
        Self {
            session_scope: session_scope.into(),
            generation: 0,
            next_id: 0,
            paths_by_id: HashMap::new(),
            ids_by_path: HashMap::new(),
        }
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn register(&mut self, path: Vec<u8>) -> Result<GitPathIdentity, GitPathRegistryError> {
        validate_path_bytes(&path)?;
        if let Some(opaque_id) = self.ids_by_path.get(&path) {
            return Ok(path_identity(opaque_id.clone(), &path));
        }

        let next_id = self
            .next_id
            .checked_add(1)
            .ok_or(GitPathRegistryError::OpaqueIdExhausted)?;
        let opaque_id = format!(
            "{}:path:{}:{}",
            self.session_scope, self.generation, next_id
        );
        if self.paths_by_id.contains_key(&opaque_id) {
            return Err(GitPathRegistryError::DuplicateOpaqueId);
        }

        self.next_id = next_id;
        let identity = path_identity(opaque_id.clone(), &path);
        self.ids_by_path.insert(path.clone(), opaque_id.clone());
        self.paths_by_id.insert(opaque_id, path);
        Ok(identity)
    }

    pub fn resolve(
        &self,
        opaque_id: &str,
        generation: u64,
        platform: GitPathPlatform,
    ) -> Result<&[u8], GitPathRegistryError> {
        if generation != self.generation {
            return Err(GitPathRegistryError::StaleGeneration);
        }
        let path = self
            .paths_by_id
            .get(opaque_id)
            .ok_or(GitPathRegistryError::UnknownOpaqueId)?;
        if platform == GitPathPlatform::Windows && std::str::from_utf8(path).is_err() {
            return Err(GitPathRegistryError::PlatformConversionUnsupported);
        }
        Ok(path)
    }

    pub fn refresh(&mut self) -> Result<(), GitPathRegistryError> {
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or(GitPathRegistryError::GenerationExhausted)?;
        self.next_id = 0;
        self.paths_by_id.clear();
        self.ids_by_path.clear();
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn insert_with_opaque_id(
        &mut self,
        opaque_id: impl Into<String>,
        path: Vec<u8>,
    ) -> Result<GitPathIdentity, GitPathRegistryError> {
        validate_path_bytes(&path)?;
        let opaque_id = opaque_id.into();
        if self.paths_by_id.contains_key(&opaque_id) {
            return Err(GitPathRegistryError::DuplicateOpaqueId);
        }
        let identity = path_identity(opaque_id.clone(), &path);
        self.ids_by_path.insert(path.clone(), opaque_id.clone());
        self.paths_by_id.insert(opaque_id, path);
        Ok(identity)
    }
}

fn validate_path_bytes(path: &[u8]) -> Result<(), GitPathRegistryError> {
    if path.is_empty() {
        return Err(GitPathRegistryError::EmptyPath);
    }
    if path.contains(&0) {
        return Err(GitPathRegistryError::PathContainsNul);
    }
    Ok(())
}

fn path_identity(opaque_id: String, path: &[u8]) -> GitPathIdentity {
    GitPathIdentity {
        opaque_id,
        display_path: safe_path_display(path),
        utf8_path: std::str::from_utf8(path).ok().map(ToOwned::to_owned),
    }
}

fn safe_path_display(path: &[u8]) -> String {
    let mut display = String::with_capacity(path.len());
    let mut remaining = path;
    while !remaining.is_empty() {
        match std::str::from_utf8(remaining) {
            Ok(valid) => {
                push_safe_valid_text(&mut display, valid);
                break;
            }
            Err(error) => {
                let valid_length = error.valid_up_to();
                if valid_length > 0 {
                    let valid = &remaining[..valid_length];
                    if let Ok(valid) = std::str::from_utf8(valid) {
                        push_safe_valid_text(&mut display, valid);
                    }
                }
                let invalid_length = error.error_len().unwrap_or(remaining.len() - valid_length);
                for byte in &remaining[valid_length..valid_length + invalid_length] {
                    push_hex_escape(&mut display, *byte);
                }
                remaining = &remaining[valid_length + invalid_length..];
            }
        }
    }
    display
}

fn push_safe_valid_text(display: &mut String, text: &str) {
    for character in text.chars() {
        match character {
            '\\' => display.push_str("\\\\"),
            '\t' => display.push_str("\\t"),
            '\n' => display.push_str("\\n"),
            '\r' => display.push_str("\\r"),
            character if character.is_control() => {
                let mut bytes = [0; 4];
                for byte in character.encode_utf8(&mut bytes).as_bytes() {
                    push_hex_escape(display, *byte);
                }
            }
            character => display.push(character),
        }
    }
}

fn push_hex_escape(display: &mut String, byte: u8) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    display.push_str("\\x");
    display.push(char::from(HEX[usize::from(byte >> 4)]));
    display.push(char::from(HEX[usize::from(byte & 0x0f)]));
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GitHeadState {
    Unborn,
    Detached {
        object_id: GitObjectId,
    },
    Branch {
        full_name: String,
        display_name: String,
        object_id: GitObjectId,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositorySummary {
    pub session_id: String,
    pub display_root: String,
    pub is_bare: bool,
    pub is_linked_worktree: bool,
    pub is_shallow: bool,
    pub object_format: GitObjectAlgorithm,
    pub head: GitHeadState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRepositoryIdentity {
    pub root: PathBuf,
    pub git_dir: PathBuf,
    pub common_dir: PathBuf,
    pub object_format: GitObjectAlgorithm,
}

#[cfg(test)]
mod tests {
    use super::{
        GitHeadState, GitObjectAlgorithm, GitObjectId, GitObjectIdError, GitPathIdentity,
        GitRepositorySummary,
    };
    use serde_json::json;

    fn sha1(hex_digit: char) -> GitObjectId {
        GitObjectId::try_new(GitObjectAlgorithm::Sha1, hex_digit.to_string().repeat(40))
            .expect("valid SHA-1 object ID")
    }

    #[test]
    fn serializes_object_and_path_dtos_with_camel_case_fields() {
        let object_id = GitObjectId::try_new(GitObjectAlgorithm::Sha256, "A".repeat(64))
            .expect("valid SHA-256 object ID");
        let path = GitPathIdentity::new(
            "session-7:path-2",
            "src\\x80-name.rs",
            Option::<String>::None,
        );

        assert_eq!(
            serde_json::to_value(object_id).expect("serialize object ID"),
            json!({
                "algorithm": "sha256",
                "hex": "a".repeat(64),
            })
        );
        assert_eq!(
            serde_json::to_value(path).expect("serialize path identity"),
            json!({
                "opaqueId": "session-7:path-2",
                "displayPath": "src\\x80-name.rs",
                "utf8Path": null,
            })
        );
    }

    #[test]
    fn serializes_repository_and_head_state_without_backend_path_identities() {
        let repository = GitRepositorySummary {
            session_id: "repository-session-1".to_string(),
            display_root: "/work/example".to_string(),
            is_bare: false,
            is_linked_worktree: true,
            is_shallow: false,
            object_format: GitObjectAlgorithm::Sha1,
            head: GitHeadState::Branch {
                full_name: "refs/heads/main".to_string(),
                display_name: "main".to_string(),
                object_id: sha1('b'),
            },
        };

        assert_eq!(
            serde_json::to_value(repository).expect("serialize repository"),
            json!({
                "sessionId": "repository-session-1",
                "displayRoot": "/work/example",
                "isBare": false,
                "isLinkedWorktree": true,
                "isShallow": false,
                "objectFormat": "sha1",
                "head": {
                    "kind": "branch",
                    "fullName": "refs/heads/main",
                    "displayName": "main",
                    "objectId": {
                        "algorithm": "sha1",
                        "hex": "b".repeat(40),
                    },
                },
            })
        );
    }

    #[test]
    fn serializes_all_head_states_to_stable_discriminated_shapes() {
        let states = [
            GitHeadState::Unborn,
            GitHeadState::Detached {
                object_id: sha1('c'),
            },
        ];

        assert_eq!(
            serde_json::to_value(states).expect("serialize head states"),
            json!([
                { "kind": "unborn" },
                {
                    "kind": "detached",
                    "objectId": {
                        "algorithm": "sha1",
                        "hex": "c".repeat(40),
                    },
                },
            ])
        );
    }

    #[test]
    fn rejects_invalid_object_ids_without_panicking() {
        assert_eq!(
            GitObjectId::try_new(GitObjectAlgorithm::Sha1, "a".repeat(39)),
            Err(GitObjectIdError::InvalidLength {
                algorithm: GitObjectAlgorithm::Sha1,
                expected: 40,
                actual: 39,
            })
        );
        assert_eq!(
            GitObjectId::try_new(GitObjectAlgorithm::Sha256, "z".repeat(64)),
            Err(GitObjectIdError::InvalidHex)
        );
        assert_eq!(
            GitObjectId::try_new(GitObjectAlgorithm::Unknown, "abc"),
            Err(GitObjectIdError::InvalidUnknownLength { actual: 3 })
        );
        assert!(
            serde_json::from_value::<GitObjectId>(json!({
                "algorithm": "sha1",
                "hex": "f".repeat(39),
            }))
            .is_err()
        );
    }

    #[test]
    fn keeps_exact_utf8_path_optional_when_conversion_is_impossible() {
        let path = GitPathIdentity::new("session:path", "bad\\xFFname", None::<String>);

        assert_eq!(path.utf8_path, None);
        assert_eq!(path.opaque_id, "session:path");
        assert_eq!(path.display_path, "bad\\xFFname");
    }
}
