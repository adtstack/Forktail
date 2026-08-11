use crate::domain::models::LineEnding;
use chardetng::EncodingDetector;
use encoding_rs::Encoding;

pub const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedText {
    pub text: String,
    pub encoding: String,
    pub line_ending: LineEnding,
    pub had_final_newline: bool,
    pub decode_had_errors: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodedTextContent {
    Text(DecodedText),
    Binary,
}

pub fn decode_text_bytes(bytes: &[u8]) -> DecodedTextContent {
    let bom = Encoding::for_bom(bytes);
    if bom.is_none() && bytes.contains(&0) {
        return DecodedTextContent::Binary;
    }

    let (text, encoding, decode_had_errors) = decode_text(bytes, bom);
    DecodedTextContent::Text(DecodedText {
        line_ending: detect_line_ending(&text),
        had_final_newline: text.ends_with('\n') || text.ends_with('\r'),
        text,
        encoding,
        decode_had_errors,
    })
}

fn decode_text(bytes: &[u8], bom: Option<(&'static Encoding, usize)>) -> (String, String, bool) {
    if let Some((encoding, bom_length)) = bom {
        let (decoded, _, had_errors) = encoding.decode(&bytes[bom_length..]);
        return (
            decoded.into_owned(),
            format!("{} BOM", encoding.name()),
            had_errors,
        );
    }

    let mut detector = EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let (decoded, _, had_errors) = encoding.decode(bytes);
    (
        decoded.into_owned(),
        encoding.name().to_string(),
        had_errors,
    )
}

pub fn detect_line_ending(text: &str) -> LineEnding {
    if text.is_empty() {
        return LineEnding::None;
    }

    let bytes = text.as_bytes();
    let mut crlf = 0usize;
    let mut bare_lf = 0usize;
    let mut bare_cr = 0usize;
    let mut index = 0usize;

    while index < bytes.len() {
        match bytes[index] {
            b'\r' if bytes.get(index + 1) == Some(&b'\n') => {
                crlf += 1;
                index += 2;
            }
            b'\r' => {
                bare_cr += 1;
                index += 1;
            }
            b'\n' => {
                bare_lf += 1;
                index += 1;
            }
            _ => index += 1,
        }
    }

    let kinds = usize::from(crlf > 0) + usize::from(bare_lf > 0) + usize::from(bare_cr > 0);
    match (kinds, crlf > 0, bare_lf > 0, bare_cr > 0) {
        (0, _, _, _) => LineEnding::None,
        (1, true, _, _) => LineEnding::Crlf,
        (1, _, true, _) => LineEnding::Lf,
        (1, _, _, true) => LineEnding::Cr,
        _ => LineEnding::Mixed,
    }
}

#[cfg(test)]
mod tests {
    use super::{DecodedTextContent, decode_text_bytes};

    #[test]
    fn rejects_bomless_nul_after_the_initial_binary_probe() {
        let mut bytes = vec![b'a'; 16 * 1024];
        bytes.push(0);

        assert_eq!(decode_text_bytes(&bytes), DecodedTextContent::Binary);
    }

    #[test]
    fn preserves_nul_code_units_for_bom_declared_utf16() {
        let decoded = decode_text_bytes(&[0xFF, 0xFE, b'a', 0, b'\n', 0]);

        assert!(matches!(decoded, DecodedTextContent::Text(_)));
    }
}
