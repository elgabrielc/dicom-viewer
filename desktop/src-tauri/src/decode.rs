use std::{
    collections::{HashMap, VecDeque},
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
use tauri::{ipc::Response, AppHandle, Runtime, State};
use tauri_plugin_fs::FsExt;

const DECODE_TIMEOUT_SECS: u64 = 30;
const MAX_DECODE_STORE_ENTRIES: usize = 8;

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

#[derive(Debug, Clone, PartialEq)]
struct DecodedFrameMetadata {
    rows: u16,
    cols: u16,
    bits_allocated: u16,
    pixel_representation: u16,
    samples_per_pixel: u16,
    planar_configuration: u16,
    photometric_interpretation: String,
    window_center: Option<f64>,
    window_width: Option<f64>,
    rescale_slope: Option<f64>,
    rescale_intercept: Option<f64>,
    pixel_data_length: usize,
}

impl DecodedFrameMetadata {
    fn into_response(self, decode_id: String) -> DecodeFrameMetadata {
        DecodeFrameMetadata {
            decode_id,
            rows: self.rows,
            cols: self.cols,
            bits_allocated: self.bits_allocated,
            pixel_representation: self.pixel_representation,
            samples_per_pixel: self.samples_per_pixel,
            planar_configuration: self.planar_configuration,
            photometric_interpretation: self.photometric_interpretation,
            window_center: self.window_center,
            window_width: self.window_width,
            rescale_slope: self.rescale_slope,
            rescale_intercept: self.rescale_intercept,
            pixel_data_length: self.pixel_data_length,
        }
    }
}

#[derive(Debug)]
struct DecodedFrame {
    metadata: DecodedFrameMetadata,
    pixel_bytes: Vec<u8>,
}

#[derive(Default)]
struct DecodeStoreEntries {
    order: VecDeque<String>,
    pixels_by_id: HashMap<String, Vec<u8>>,
}

#[derive(Default)]
pub struct DecodeStore {
    next_id: AtomicU64,
    entries: Mutex<DecodeStoreEntries>,
}

impl DecodeStore {
    fn insert(&self, pixel_bytes: Vec<u8>) -> String {
        // Uniqueness only depends on atomicity here; we do not need cross-thread ordering.
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let decode_id = format!("decode-{id}");
        let mut entries = self.entries.lock().expect("decode store poisoned");
        entries.pixels_by_id.insert(decode_id.clone(), pixel_bytes);
        entries.order.push_back(decode_id.clone());

        while entries.order.len() > MAX_DECODE_STORE_ENTRIES {
            if let Some(stale_decode_id) = entries.order.pop_front() {
                entries.pixels_by_id.remove(&stale_decode_id);
            }
        }

        decode_id
    }

    fn take(&self, decode_id: &str) -> Option<Vec<u8>> {
        let mut entries = self.entries.lock().expect("decode store poisoned");
        let pixel_bytes = entries.pixels_by_id.remove(decode_id)?;
        if let Some(index) = entries.order.iter().position(|id| id == decode_id) {
            entries.order.remove(index);
        }
        Some(pixel_bytes)
    }

    #[cfg(test)]
    fn pending_count(&self) -> usize {
        self.entries
            .lock()
            .expect("decode store poisoned")
            .pixels_by_id
            .len()
    }
}

#[tauri::command]
pub async fn decode_frame<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    frame_index: u32,
    store: State<'_, DecodeStore>,
) -> Result<DecodeFrameMetadata, String> {
    let scoped_path = validate_decode_path(&app, &path)?;
    let decode_result = run_decode_with_timeout(scoped_path, frame_index).await?;
    let decode_id = store.insert(decode_result.pixel_bytes);
    Ok(decode_result.metadata.into_response(decode_id))
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

async fn run_decode_with_timeout(path: PathBuf, frame_index: u32) -> Result<DecodedFrame, String> {
    let decode_task = tokio::task::spawn_blocking(move || decode_frame_impl(&path, frame_index));

    match tokio::time::timeout(Duration::from_secs(DECODE_TIMEOUT_SECS), decode_task).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(format!(
            "Native decode worker ended before producing a result: {error}"
        )),
        Err(_) => Err(format!(
            "Native decode timed out after {DECODE_TIMEOUT_SECS}s while waiting on the bounded blocking pool."
        )),
    }
}

fn validate_decode_path<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let requested_path = PathBuf::from(path);
    if requested_path.as_os_str().is_empty() {
        return Err("Decode path is empty.".into());
    }
    if !requested_path.is_absolute() {
        return Err(format!("Decode path must be absolute: {path}"));
    }

    let canonical_path = requested_path
        .canonicalize()
        .map_err(|e| format!("Failed to open DICOM file {path}: {e}"))?;

    if !app.fs_scope().is_allowed(&canonical_path) {
        return Err(format!(
            "Decode path is outside the allowed desktop file scope: {}",
            canonical_path.display()
        ));
    }

    Ok(canonical_path)
}

fn decode_frame_impl(path: &Path, frame_index: u32) -> Result<DecodedFrame, String> {
    let object = open_file(path)
        .map_err(|e| format!("Failed to open DICOM file {}: {e}", path.display()))?;

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
        metadata: DecodedFrameMetadata {
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
    fn decode_store_evicts_oldest_entries_when_capacity_is_exceeded() {
        let store = DecodeStore::default();
        let mut decode_ids = Vec::new();

        for value in 0..=MAX_DECODE_STORE_ENTRIES {
            decode_ids.push(store.insert(vec![value as u8]));
        }

        assert_eq!(store.pending_count(), MAX_DECODE_STORE_ENTRIES);
        assert_eq!(store.take(&decode_ids[0]), None);
        assert_eq!(
            store.take(decode_ids.last().unwrap()),
            Some(vec![MAX_DECODE_STORE_ENTRIES as u8])
        );
    }

    #[test]
    fn decode_frame_impl_decodes_real_jpeg2000_fixture() {
        let fixture = fixture_path("test-data/mri-samples/MR2_J2KI.dcm");
        let decoded = decode_frame_impl(&fixture, 0).expect("fixture should decode");

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
