use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

use dicom_core::Tag;
use dicom_dictionary_std::tags;
use dicom_object::{open_file, DefaultDicomObject};
use dicom_pixeldata::{DecodedPixelData, PixelDecoder};
use serde::Serialize;
use tauri::{ipc::Response, State};

const DECODE_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecodeFrameMetadata {
    pub decode_id: String,
    pub rows: u16,
    pub cols: u16,
    pub bits_allocated: u16,
    pub pixel_representation: u16,
    pub samples_per_pixel: u16,
    pub planar_configuration: u16,
    pub photometric_interpretation: String,
    pub window_center: Option<f64>,
    pub window_width: Option<f64>,
    pub rescale_slope: Option<f64>,
    pub rescale_intercept: Option<f64>,
    pub pixel_data_length: usize,
}

#[derive(Debug)]
struct DecodedFrame {
    metadata: DecodeFrameMetadata,
    pixel_bytes: Vec<u8>,
}

#[derive(Default)]
pub struct DecodeStore {
    next_id: AtomicU64,
    entries: Mutex<HashMap<String, Vec<u8>>>,
}

impl DecodeStore {
    fn insert(&self, pixel_bytes: Vec<u8>) -> String {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let decode_id = format!("decode-{id}");
        self.entries
            .lock()
            .expect("decode store poisoned")
            .insert(decode_id.clone(), pixel_bytes);
        decode_id
    }

    fn take(&self, decode_id: &str) -> Option<Vec<u8>> {
        self.entries
            .lock()
            .expect("decode store poisoned")
            .remove(decode_id)
    }
}

#[tauri::command]
pub async fn decode_frame(
    path: String,
    frame_index: u32,
    store: State<'_, DecodeStore>,
) -> Result<DecodeFrameMetadata, String> {
    let decode_result = run_decode_with_timeout(path, frame_index).await?;
    let decode_id = store.insert(decode_result.pixel_bytes);
    Ok(DecodeFrameMetadata {
        decode_id,
        ..decode_result.metadata
    })
}

#[tauri::command]
pub fn take_decoded_frame(
    decode_id: String,
    store: State<'_, DecodeStore>,
) -> Result<Response, String> {
    let pixel_bytes = store
        .take(&decode_id)
        .ok_or_else(|| format!("Decoded frame not found: {decode_id}"))?;
    Ok(Response::new(pixel_bytes))
}

async fn run_decode_with_timeout(path: String, frame_index: u32) -> Result<DecodedFrame, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let _ = tx.send(decode_frame_impl(&path, frame_index));
    });

    match tokio::time::timeout(Duration::from_secs(DECODE_TIMEOUT_SECS), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("Native decode worker ended before producing a result.".into()),
        Err(_) => Err(format!(
            "Native decode timed out after {DECODE_TIMEOUT_SECS}s. The decode thread may still be running."
        )),
    }
}

fn decode_frame_impl(path: &str, frame_index: u32) -> Result<DecodedFrame, String> {
    let object = open_file(path).map_err(|e| format!("Failed to open DICOM file {path}: {e}"))?;

    let rows = required_u16(&object, tags::ROWS, "Rows")?;
    let cols = required_u16(&object, tags::COLUMNS, "Columns")?;
    let bits_allocated = required_u16(&object, tags::BITS_ALLOCATED, "Bits Allocated")?;
    let pixel_representation = get_u16(&object, tags::PIXEL_REPRESENTATION).unwrap_or_default();
    let samples_per_pixel = get_u16(&object, tags::SAMPLES_PER_PIXEL).unwrap_or(1);
    let planar_configuration = get_u16(&object, tags::PLANAR_CONFIGURATION).unwrap_or(0);
    let photometric_interpretation =
        get_text(&object, tags::PHOTOMETRIC_INTERPRETATION).unwrap_or_else(|| "MONOCHROME2".into());
    let frame_count = get_u32(&object, tags::NUMBER_OF_FRAMES).unwrap_or(1);

    if frame_index >= frame_count {
        return Err(format!(
            "Requested frame {frame_index} but dataset only has {frame_count} frame(s)."
        ));
    }

    let decoded = object
        .decode_pixel_data_frame(frame_index)
        .map_err(|e| format!("Failed to decode frame {frame_index}: {e}"))?;
    let pixel_bytes = decoded_pixels_to_bytes(decoded);

    Ok(DecodedFrame {
        metadata: DecodeFrameMetadata {
            decode_id: String::new(),
            rows,
            cols,
            bits_allocated,
            pixel_representation,
            samples_per_pixel,
            planar_configuration,
            photometric_interpretation,
            window_center: get_first_f64(&object, tags::WINDOW_CENTER),
            window_width: get_first_f64(&object, tags::WINDOW_WIDTH),
            rescale_slope: get_first_f64(&object, tags::RESCALE_SLOPE),
            rescale_intercept: get_first_f64(&object, tags::RESCALE_INTERCEPT),
            pixel_data_length: pixel_bytes.len(),
        },
        pixel_bytes,
    })
}

fn decoded_pixels_to_bytes(decoded: DecodedPixelData<'_>) -> Vec<u8> {
    decoded.data().to_vec()
}

fn get_text(object: &DefaultDicomObject, tag: Tag) -> Option<String> {
    object
        .element_opt(tag)
        .ok()
        .flatten()
        .and_then(|element| element.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn get_u16(object: &DefaultDicomObject, tag: Tag) -> Option<u16> {
    object
        .element_opt(tag)
        .ok()
        .flatten()
        .and_then(|element| element.to_int::<u16>().ok())
}

fn get_u32(object: &DefaultDicomObject, tag: Tag) -> Option<u32> {
    object
        .element_opt(tag)
        .ok()
        .flatten()
        .and_then(|element| element.to_int::<u32>().ok())
}

fn required_u16(object: &DefaultDicomObject, tag: Tag, label: &str) -> Result<u16, String> {
    get_u16(object, tag).ok_or_else(|| format!("Missing or invalid DICOM field: {label}"))
}

fn get_first_f64(object: &DefaultDicomObject, tag: Tag) -> Option<f64> {
    object
        .element_opt(tag)
        .ok()
        .flatten()
        .and_then(|element| element.to_multi_float64().ok())
        .and_then(|values| values.into_iter().next())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_path(relative: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join(relative)
    }

    #[test]
    fn decode_store_take_removes_entries() {
        let store = DecodeStore::default();
        let decode_id = store.insert(vec![1, 2, 3, 4]);

        assert_eq!(store.take(&decode_id), Some(vec![1, 2, 3, 4]));
        assert_eq!(store.take(&decode_id), None);
    }

    #[test]
    fn decode_frame_impl_decodes_real_jpeg2000_fixture() {
        let fixture = fixture_path("test-data/mri-samples/MR2_J2KI.dcm");
        let decoded =
            decode_frame_impl(fixture.to_str().unwrap(), 0).expect("fixture should decode");

        assert_eq!(decoded.metadata.rows, 1024);
        assert_eq!(decoded.metadata.cols, 1024);
        assert_eq!(decoded.metadata.bits_allocated, 16);
        assert_eq!(decoded.metadata.pixel_representation, 0);
        assert_eq!(decoded.metadata.samples_per_pixel, 1);
        assert_eq!(decoded.metadata.photometric_interpretation, "MONOCHROME2");
        assert_eq!(decoded.metadata.pixel_data_length, 1024 * 1024 * 2);
        assert_eq!(
            decoded.pixel_bytes.len(),
            decoded.metadata.pixel_data_length
        );
    }
}
