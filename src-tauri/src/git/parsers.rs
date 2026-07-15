#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NulParseLimits {
    pub max_input_bytes: usize,
    pub max_records: usize,
    pub max_field_bytes: usize,
    pub max_record_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitParseError {
    InvalidFieldsPerRecord,
    MissingFinalNul,
    EmptyField {
        field_index: usize,
    },
    InvalidFieldCount {
        fields_per_record: usize,
        actual_fields: usize,
    },
    InputTooLarge {
        limit: usize,
        actual: usize,
    },
    FieldTooLarge {
        field_index: usize,
        limit: usize,
        actual: usize,
    },
    RecordTooLarge {
        record_index: usize,
        limit: usize,
        actual: usize,
    },
    TooManyRecords {
        limit: usize,
        actual: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NulRecord<'a> {
    fields: Vec<&'a [u8]>,
}

impl<'a> NulRecord<'a> {
    pub fn fields(&self) -> &[&'a [u8]] {
        &self.fields
    }
}

pub fn parse_nul_records(
    input: &[u8],
    fields_per_record: usize,
    limits: NulParseLimits,
) -> Result<Vec<NulRecord<'_>>, GitParseError> {
    if fields_per_record == 0 {
        return Err(GitParseError::InvalidFieldsPerRecord);
    }
    if input.len() > limits.max_input_bytes {
        return Err(GitParseError::InputTooLarge {
            limit: limits.max_input_bytes,
            actual: input.len(),
        });
    }
    if input.is_empty() {
        return Ok(Vec::new());
    }
    if !input.ends_with(b"\0") {
        return Err(GitParseError::MissingFinalNul);
    }

    let fields = input[..input.len() - 1]
        .split(|byte| *byte == 0)
        .enumerate()
        .map(|(field_index, field)| {
            if field.is_empty() {
                return Err(GitParseError::EmptyField { field_index });
            }
            if field.len() > limits.max_field_bytes {
                return Err(GitParseError::FieldTooLarge {
                    field_index,
                    limit: limits.max_field_bytes,
                    actual: field.len(),
                });
            }
            Ok(field)
        })
        .collect::<Result<Vec<_>, _>>()?;

    if fields.len() % fields_per_record != 0 {
        return Err(GitParseError::InvalidFieldCount {
            fields_per_record,
            actual_fields: fields.len(),
        });
    }

    let record_count = fields.len() / fields_per_record;
    if record_count > limits.max_records {
        return Err(GitParseError::TooManyRecords {
            limit: limits.max_records,
            actual: record_count,
        });
    }

    fields
        .chunks_exact(fields_per_record)
        .enumerate()
        .map(|(record_index, record_fields)| {
            let record_size = record_fields
                .iter()
                .try_fold(0usize, |size, field| {
                    size.checked_add(field.len())?.checked_add(1)
                })
                .unwrap_or(usize::MAX);
            if record_size > limits.max_record_bytes {
                return Err(GitParseError::RecordTooLarge {
                    record_index,
                    limit: limits.max_record_bytes,
                    actual: record_size,
                });
            }
            Ok(NulRecord {
                fields: record_fields.to_vec(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{GitParseError, NulParseLimits, parse_nul_records};
    use crate::domain::git::{GitPathPlatform, GitPathRegistry, GitPathRegistryError};

    fn limits() -> NulParseLimits {
        NulParseLimits {
            max_input_bytes: 1024,
            max_records: 16,
            max_field_bytes: 256,
            max_record_bytes: 512,
        }
    }

    #[test]
    fn preserves_space_tab_newline_control_and_non_utf8_path_bytes() {
        let input = b"space path\0tab\tpath\0line\npath\0control\x01path\0bad\xffname\0";
        let records = parse_nul_records(input, 1, limits()).expect("path records");

        assert_eq!(records.len(), 5);
        assert_eq!(records[0].fields(), &[b"space path".as_slice()]);
        assert_eq!(records[1].fields(), &[b"tab\tpath".as_slice()]);
        assert_eq!(records[2].fields(), &[b"line\npath".as_slice()]);
        assert_eq!(records[3].fields(), &[b"control\x01path".as_slice()]);
        assert_eq!(records[4].fields(), &[b"bad\xffname".as_slice()]);
    }

    #[test]
    fn distinguishes_empty_truncated_and_extra_fields() {
        assert_eq!(
            parse_nul_records(b"one\0two", 1, limits()),
            Err(GitParseError::MissingFinalNul)
        );
        assert_eq!(
            parse_nul_records(b"one\0\0", 1, limits()),
            Err(GitParseError::EmptyField { field_index: 1 })
        );
        assert_eq!(
            parse_nul_records(b"one\0two\0extra\0", 2, limits()),
            Err(GitParseError::InvalidFieldCount {
                fields_per_record: 2,
                actual_fields: 3,
            })
        );
        assert_eq!(
            parse_nul_records(b"", 1, limits()).expect("empty record set"),
            Vec::new()
        );
        assert_eq!(
            parse_nul_records(b"one\0", 0, limits()),
            Err(GitParseError::InvalidFieldsPerRecord)
        );
    }

    #[test]
    fn rejects_input_field_record_and_record_count_overflow() {
        let mut input_limited = limits();
        input_limited.max_input_bytes = 3;
        assert_eq!(
            parse_nul_records(b"abc\0", 1, input_limited),
            Err(GitParseError::InputTooLarge {
                limit: 3,
                actual: 4,
            })
        );

        let mut field_limited = limits();
        field_limited.max_field_bytes = 2;
        assert_eq!(
            parse_nul_records(b"abc\0", 1, field_limited),
            Err(GitParseError::FieldTooLarge {
                field_index: 0,
                limit: 2,
                actual: 3,
            })
        );

        let mut record_limited = limits();
        record_limited.max_record_bytes = 5;
        assert_eq!(
            parse_nul_records(b"abc\0def\0", 2, record_limited),
            Err(GitParseError::RecordTooLarge {
                record_index: 0,
                limit: 5,
                actual: 8,
            })
        );

        let mut count_limited = limits();
        count_limited.max_records = 1;
        assert_eq!(
            parse_nul_records(b"one\0two\0", 1, count_limited),
            Err(GitParseError::TooManyRecords {
                limit: 1,
                actual: 2,
            })
        );
    }

    #[test]
    fn registry_keeps_raw_identity_backend_only_and_escapes_display_text() {
        let mut registry = GitPathRegistry::new("repository-session-1");
        let path = b"src/\xffline\n\t\\name".to_vec();
        let identity = registry.register(path.clone()).expect("register path");

        assert_eq!(identity.display_path, "src/\\xffline\\n\\t\\\\name");
        assert_eq!(identity.utf8_path, None);
        assert_eq!(
            registry
                .resolve(
                    &identity.opaque_id,
                    registry.generation(),
                    GitPathPlatform::Unix,
                )
                .expect("Unix byte path"),
            path
        );
        assert_eq!(
            registry.resolve(
                &identity.opaque_id,
                registry.generation(),
                GitPathPlatform::Windows,
            ),
            Err(GitPathRegistryError::PlatformConversionUnsupported)
        );
    }

    #[test]
    fn registry_rejects_duplicate_ids_and_invalidates_refresh_generation() {
        let mut registry = GitPathRegistry::new("repository-session-1");
        registry
            .insert_with_opaque_id("forced-id", b"first.txt".to_vec())
            .expect("first explicit ID");
        assert_eq!(
            registry.insert_with_opaque_id("forced-id", b"second.txt".to_vec()),
            Err(GitPathRegistryError::DuplicateOpaqueId)
        );

        let identity = registry
            .register("Unicode-한글.txt".as_bytes().to_vec())
            .expect("valid UTF-8 path");
        let previous_generation = registry.generation();
        assert_eq!(identity.display_path, "Unicode-한글.txt");
        assert_eq!(identity.utf8_path.as_deref(), Some("Unicode-한글.txt"));

        registry.refresh().expect("refresh generation");
        assert_eq!(
            registry.resolve(
                &identity.opaque_id,
                previous_generation,
                GitPathPlatform::Unix,
            ),
            Err(GitPathRegistryError::StaleGeneration)
        );
    }

    #[test]
    fn opaque_ids_are_session_scoped_and_lossy_display_is_never_a_lookup_key() {
        let mut first = GitPathRegistry::new("repository-session-1");
        let mut second = GitPathRegistry::new("repository-session-2");
        let first_identity = first.register(b"bad\xffname".to_vec()).expect("first path");
        let second_identity = second
            .register(b"bad\xffname".to_vec())
            .expect("second path");

        assert_ne!(first_identity.opaque_id, second_identity.opaque_id);
        assert_eq!(first_identity.display_path, second_identity.display_path);
        assert_eq!(
            second.resolve(
                &first_identity.opaque_id,
                second.generation(),
                GitPathPlatform::Unix,
            ),
            Err(GitPathRegistryError::UnknownOpaqueId)
        );
        assert_eq!(
            first.resolve(
                &first_identity.display_path,
                first.generation(),
                GitPathPlatform::Unix,
            ),
            Err(GitPathRegistryError::UnknownOpaqueId)
        );
    }
}
