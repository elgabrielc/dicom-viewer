use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        LazyLock, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use dicom_core::Tag;
use dicom_dictionary_std::tags;
use dicom_object::{open_file, DefaultDicomObject};
use dicom_pixeldata::{DecodedPixelData, PixelDecoder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{ipc::Response, AppHandle, Manager, Runtime, State};

use crate::DebugSettings;

const DECODE_TIMEOUT_SECS: u64 = 30;
const MAX_DECODE_STORE_ENTRIES: usize = 8;
const DECODE_CACHE_DIR_NAME: &str = "decode-cache";
const DECODE_CACHE_MANIFEST_NAME: &str = "manifest.json";
const MAX_DECODE_CACHE_ENTRIES: usize = 1000;
const MAX_DECODE_CACHE_BYTES: u64 = 500 * 1024 * 1024;
const MAX_DECODE_CACHE_EVICTIONS_PER_WRITE: usize = 20;
const MAX_SCAN_HEADER_BYTES: usize = 256 * 1024;

type DecodeResult<T> = Result<T, DecodeError>;

static PENDING_CACHE_TOUCHES: LazyLock<Mutex<HashMap<String, u128>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static DECODE_CACHE_IO_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecodeError {
    pub stage: String,
    pub message: String,
}

impl DecodeError {
    fn new(stage: &str, message: impl Into<String>) -> Self {
        Self {
            stage: stage.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DecodeFrameBinaryHeader {
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

impl From<DecodedFrameMetadata> for DecodeFrameBinaryHeader {
    fn from(metadata: DecodedFrameMetadata) -> Self {
        Self {
            rows: metadata.rows,
            cols: metadata.cols,
            bits_allocated: metadata.bits_allocated,
            pixel_representation: metadata.pixel_representation,
            samples_per_pixel: metadata.samples_per_pixel,
            planar_configuration: metadata.planar_configuration,
            photometric_interpretation: metadata.photometric_interpretation,
            window_center: metadata.window_center,
            window_width: metadata.window_width,
            rescale_slope: metadata.rescale_slope,
            rescale_intercept: metadata.rescale_intercept,
            pixel_data_length: metadata.pixel_data_length,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, PartialEq)]
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

    fn pending_count_live(&self) -> usize {
        self.entries
            .lock()
            .expect("decode store poisoned")
            .pixels_by_id
            .len()
    }
}

#[derive(Debug, Clone, PartialEq)]
struct DecodeCachePaths {
    dir: PathBuf,
    manifest: PathBuf,
}

impl DecodeCachePaths {
    fn new(dir: PathBuf) -> Self {
        Self {
            manifest: dir.join(DECODE_CACHE_MANIFEST_NAME),
            dir,
        }
    }

    fn entry_paths(&self, cache_key: &str) -> DecodeCacheEntryPaths {
        DecodeCacheEntryPaths {
            pixel_bytes: self.dir.join(format!("{cache_key}.raw")),
            metadata: self.dir.join(format!("{cache_key}.json")),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct DecodeCacheEntryPaths {
    pixel_bytes: PathBuf,
    metadata: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DecodeCacheManifest {
    entries: Vec<DecodeCacheManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DecodeCacheManifestEntry {
    key: String,
    pixel_data_length: usize,
    last_accessed_ms: u128,
}

#[tauri::command]
pub async fn decode_frame<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    frame_index: u32,
    store: State<'_, DecodeStore>,
    debug_settings: State<'_, DebugSettings>,
    allowed: State<'_, crate::path_util::AllowedPaths>,
) -> DecodeResult<DecodeFrameMetadata> {
    let scoped_path = crate::path_util::resolve_within_scope(&path, "decode", &allowed)
        .map_err(|msg| DecodeError::new("decode", msg))?;
    let cache_paths = resolve_cache_paths(&app)?;
    let native_decode_debug = debug_settings.native_decode_debug;
    let started_at = Instant::now();
    let decode_result = run_decode_with_timeout(
        scoped_path.clone(),
        frame_index,
        cache_paths,
        native_decode_debug,
    )
    .await?;
    let pixel_data_length = decode_result.metadata.pixel_data_length;
    let decode_id = store.insert(decode_result.pixel_bytes);
    if native_decode_debug {
        eprintln!(
            "[native-decode] response path={} frame={} decode_id={} pixel_bytes={} store_pending={} elapsed_ms={}",
            scoped_path.display(),
            frame_index,
            decode_id,
            pixel_data_length,
            store.pending_count_live(),
            started_at.elapsed().as_millis()
        );
    }
    Ok(decode_result.metadata.into_response(decode_id))
}

#[tauri::command]
pub async fn decode_frame_with_pixels<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    frame_index: u32,
    debug_settings: State<'_, DebugSettings>,
    allowed: State<'_, crate::path_util::AllowedPaths>,
) -> DecodeResult<Response> {
    let scoped_path = crate::path_util::resolve_within_scope(&path, "decode", &allowed)
        .map_err(|msg| DecodeError::new("decode", msg))?;
    let cache_paths = resolve_cache_paths(&app)?;
    let native_decode_debug = debug_settings.native_decode_debug;
    let started_at = Instant::now();
    let decoded_frame = run_decode_with_timeout(
        scoped_path.clone(),
        frame_index,
        cache_paths,
        native_decode_debug,
    )
    .await?;
    let pixel_data_length = decoded_frame.metadata.pixel_data_length;
    let response = build_decode_frame_with_pixels_response(decoded_frame)?;
    if native_decode_debug {
        eprintln!(
            "[native-decode] response-with-pixels path={} frame={} pixel_bytes={} elapsed_ms={}",
            scoped_path.display(),
            frame_index,
            pixel_data_length,
            started_at.elapsed().as_millis()
        );
    }
    Ok(response)
}

#[tauri::command]
pub async fn read_scan_header<R: Runtime>(
    _app: AppHandle<R>,
    path: String,
    max_bytes: usize,
    allowed: State<'_, crate::path_util::AllowedPaths>,
) -> DecodeResult<Response> {
    let scoped_path = crate::path_util::resolve_within_scope(&path, "scan-header", &allowed)
        .map_err(|msg| DecodeError::new("scan-header", msg))?;
    let bytes = tokio::task::spawn_blocking(move || read_scan_header_impl(&scoped_path, max_bytes))
        .await
        .map_err(|error| {
            DecodeError::new(
                "scan-header",
                format!("Native scan header worker ended before producing a result: {error}"),
            )
        })??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn take_decoded_frame(
    decode_id: String,
    store: State<'_, DecodeStore>,
) -> DecodeResult<Response> {
    let pixel_bytes = store
        .take(&decode_id)
        .ok_or_else(|| DecodeError::new("pixel-transfer", format!("Decoded frame not found: {decode_id}")))?;
    Ok(Response::new(pixel_bytes))
}

async fn run_decode_with_timeout(
    path: PathBuf,
    frame_index: u32,
    cache_paths: DecodeCachePaths,
    native_decode_debug: bool,
) -> DecodeResult<DecodedFrame> {
    let decode_task = tokio::task::spawn_blocking(move || {
        decode_frame_impl_with_cache(&path, frame_index, &cache_paths, native_decode_debug)
    });

    match tokio::time::timeout(Duration::from_secs(DECODE_TIMEOUT_SECS), decode_task).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(DecodeError::new(
            "decode",
            format!("Native decode worker ended before producing a result: {error}"),
        )),
        Err(_) => Err(DecodeError::new(
            "decode-timeout",
            format!(
                "Native decode timed out after {DECODE_TIMEOUT_SECS}s while waiting on the bounded blocking pool."
            ),
        )),
    }
}

fn resolve_cache_paths<R: Runtime>(app: &AppHandle<R>) -> DecodeResult<DecodeCachePaths> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        DecodeError::new(
            "cache-write",
            format!("Failed to resolve the desktop app data directory: {error}"),
        )
    })?;
    let cache_paths = DecodeCachePaths::new(app_data_dir.join(DECODE_CACHE_DIR_NAME));
    fs::create_dir_all(&cache_paths.dir).map_err(|error| {
        DecodeError::new(
            "cache-write",
            format!(
                "Failed to create decode cache directory {}: {error}",
                cache_paths.dir.display()
            ),
        )
    })?;
    Ok(cache_paths)
}


fn read_scan_header_impl(path: &Path, max_bytes: usize) -> DecodeResult<Vec<u8>> {
    let capped_max_bytes = max_bytes.min(MAX_SCAN_HEADER_BYTES);
    if capped_max_bytes == 0 {
        return Ok(Vec::new());
    }

    let file = fs::File::open(path).map_err(|error| {
        DecodeError::new(
            "scan-header",
            format!("Failed to open DICOM file {}: {error}", path.display()),
        )
    })?;
    let mut bytes = Vec::with_capacity(capped_max_bytes);
    file.take(capped_max_bytes as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            DecodeError::new(
                "scan-header",
                format!("Failed to read scan header from {}: {error}", path.display()),
            )
        })?;
    Ok(bytes)
}

fn build_decode_frame_with_pixels_response(decoded_frame: DecodedFrame) -> DecodeResult<Response> {
    let DecodedFrame {
        metadata,
        mut pixel_bytes,
    } = decoded_frame;
    let metadata_json = serde_json::to_vec(&DecodeFrameBinaryHeader::from(metadata)).map_err(|error| {
        DecodeError::new(
            "pixel-transfer",
            format!("Failed to serialize decoded frame metadata: {error}"),
        )
    })?;
    let metadata_length = u32::try_from(metadata_json.len()).map_err(|_| {
        DecodeError::new(
            "pixel-transfer",
            "Decoded frame metadata header exceeded the desktop binary response size limit.",
        )
    })?;

    let mut payload = Vec::with_capacity(4 + metadata_json.len() + pixel_bytes.len());
    payload.extend_from_slice(&metadata_length.to_le_bytes());
    payload.extend_from_slice(&metadata_json);
    payload.append(&mut pixel_bytes);
    Ok(Response::new(payload))
}

fn decode_frame_impl_with_cache(
    path: &Path,
    frame_index: u32,
    cache_paths: &DecodeCachePaths,
    native_decode_debug: bool,
) -> DecodeResult<DecodedFrame> {
    let started_at = Instant::now();
    let object = open_file(path).map_err(|error| {
        DecodeError::new(
            "decode",
            format!("Failed to open DICOM file {}: {error}", path.display()),
        )
    })?;

    let cache_key = match build_cache_key(path, &object, frame_index) {
        Ok(key) => Some(key),
        Err(error) => {
            eprintln!("Skipping decode cache key generation: {error}");
            None
        }
    };

    if let Some(cache_key) = cache_key.as_deref() {
        let cached_frame = {
            let _cache_guard = DECODE_CACHE_IO_LOCK
                .lock()
                .expect("decode cache I/O lock poisoned");
            read_cached_frame(cache_paths, cache_key)
        };
        if let Some(cached_frame) = cached_frame {
            if native_decode_debug {
                eprintln!(
                    "[native-decode] cache-hit path={} frame={} pixel_bytes={} rows={} cols={} elapsed_ms={}",
                    path.display(),
                    frame_index,
                    cached_frame.metadata.pixel_data_length,
                    cached_frame.metadata.rows,
                    cached_frame.metadata.cols,
                    started_at.elapsed().as_millis()
                );
            }
            return Ok(cached_frame);
        }
    }

    let decoded_frame = decode_frame_from_object(path, &object, frame_index)?;

    if let Some(cache_key) = cache_key.as_deref() {
        let cache_write_result = {
            let _cache_guard = DECODE_CACHE_IO_LOCK
                .lock()
                .expect("decode cache I/O lock poisoned");
            write_cached_frame(cache_paths, cache_key, &decoded_frame)
        };
        if let Err(error) = cache_write_result {
            eprintln!("Skipping decode cache write for {}: {}", path.display(), error);
        }
    }

    if native_decode_debug {
        eprintln!(
            "[native-decode] cache-miss path={} frame={} pixel_bytes={} rows={} cols={} elapsed_ms={}",
            path.display(),
            frame_index,
            decoded_frame.metadata.pixel_data_length,
            decoded_frame.metadata.rows,
            decoded_frame.metadata.cols,
            started_at.elapsed().as_millis()
        );
    }

    Ok(decoded_frame)
}

fn build_cache_key(
    path: &Path,
    object: &DefaultDicomObject,
    frame_index: u32,
) -> Result<String, String> {
    let file_metadata =
        fs::metadata(path).map_err(|error| format!("Failed to read file metadata: {error}"))?;
    let modified = file_metadata
        .modified()
        .map_err(|error| format!("Failed to read file modification time: {error}"))?;
    let modified_ms = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Invalid file modification time: {error}"))?
        .as_millis()
        .to_string();
    let sop_instance_uid =
        get_text(object, tags::SOP_INSTANCE_UID).unwrap_or_else(|| "missing-sop-instance-uid".into());
    let transfer_syntax =
        get_text(object, tags::TRANSFER_SYNTAX_UID).unwrap_or_else(|| "missing-transfer-syntax".into());

    let mut hasher = Sha256::new();
    hasher.update(path.as_os_str().as_encoded_bytes());
    hasher.update(b"|");
    hasher.update(sop_instance_uid.as_bytes());
    hasher.update(b"|");
    hasher.update(frame_index.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update(transfer_syntax.as_bytes());
    hasher.update(b"|");
    hasher.update(modified_ms.as_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}

fn read_cached_frame(cache_paths: &DecodeCachePaths, cache_key: &str) -> Option<DecodedFrame> {
    let entry_paths = cache_paths.entry_paths(cache_key);
    let metadata_text = fs::read_to_string(&entry_paths.metadata).ok()?;
    let metadata: DecodedFrameMetadata = serde_json::from_str(&metadata_text).ok()?;
    let pixel_bytes = fs::read(&entry_paths.pixel_bytes).ok()?;
    if pixel_bytes.len() != metadata.pixel_data_length {
        return None;
    }

    record_cache_touch(cache_key);

    Some(DecodedFrame {
        metadata,
        pixel_bytes,
    })
}

fn write_cached_frame(
    cache_paths: &DecodeCachePaths,
    cache_key: &str,
    decoded_frame: &DecodedFrame,
) -> Result<(), String> {
    fs::create_dir_all(&cache_paths.dir)
        .map_err(|error| format!("Failed to create cache directory: {error}"))?;

    let mut manifest = load_cache_manifest(cache_paths)?;
    reconcile_cache_directory(cache_paths, &mut manifest)?;

    let entry_paths = cache_paths.entry_paths(cache_key);
    write_atomic_file(&entry_paths.pixel_bytes, &decoded_frame.pixel_bytes)
        .map_err(|error| format!("Failed to write cached pixels: {error}"))?;
    let metadata_json = serde_json::to_vec(&decoded_frame.metadata)
        .map_err(|error| format!("Failed to serialize cached metadata: {error}"))?;
    write_atomic_file(&entry_paths.metadata, &metadata_json)
        .map_err(|error| format!("Failed to write cached metadata: {error}"))?;

    apply_pending_cache_touches(&mut manifest);
    upsert_manifest_entry(
        &mut manifest,
        cache_key,
        decoded_frame.metadata.pixel_data_length,
    );
    enforce_cache_limits(
        cache_paths,
        &mut manifest,
        MAX_DECODE_CACHE_ENTRIES,
        MAX_DECODE_CACHE_BYTES,
        MAX_DECODE_CACHE_EVICTIONS_PER_WRITE,
    )?;
    save_cache_manifest(cache_paths, &manifest)
}

fn load_cache_manifest(cache_paths: &DecodeCachePaths) -> Result<DecodeCacheManifest, String> {
    if !cache_paths.manifest.exists() {
        return Ok(DecodeCacheManifest::default());
    }

    let manifest_json = fs::read_to_string(&cache_paths.manifest)
        .map_err(|error| format!("Failed to read cache manifest: {error}"))?;
    serde_json::from_str(&manifest_json)
        .map_err(|error| format!("Failed to parse cache manifest: {error}"))
}

fn save_cache_manifest(
    cache_paths: &DecodeCachePaths,
    manifest: &DecodeCacheManifest,
) -> Result<(), String> {
    let manifest_json = serde_json::to_vec(manifest)
        .map_err(|error| format!("Failed to serialize cache manifest: {error}"))?;
    write_atomic_file(&cache_paths.manifest, &manifest_json)
        .map_err(|error| format!("Failed to write cache manifest: {error}"))
}

fn upsert_manifest_entry(
    manifest: &mut DecodeCacheManifest,
    cache_key: &str,
    pixel_data_length: usize,
) {
    manifest.entries.retain(|entry| entry.key != cache_key);
    manifest.entries.push(DecodeCacheManifestEntry {
        key: cache_key.to_string(),
        pixel_data_length,
        last_accessed_ms: current_time_ms(),
    });
}

fn enforce_cache_limits(
    cache_paths: &DecodeCachePaths,
    manifest: &mut DecodeCacheManifest,
    max_entries: usize,
    max_bytes: u64,
    max_evictions_per_pass: usize,
) -> Result<(), String> {
    manifest
        .entries
        .sort_by_key(|entry| (entry.last_accessed_ms, entry.key.clone()));

    let mut total_bytes = manifest
        .entries
        .iter()
        .map(|entry| entry.pixel_data_length as u64)
        .sum::<u64>();
    let mut evictions = 0usize;

    while (manifest.entries.len() > max_entries || total_bytes > max_bytes)
        && evictions < max_evictions_per_pass
    {
        let stale_entry = manifest.entries.remove(0);
        total_bytes = total_bytes.saturating_sub(stale_entry.pixel_data_length as u64);
        let stale_paths = cache_paths.entry_paths(&stale_entry.key);
        remove_if_exists(&stale_paths.pixel_bytes)
            .map_err(|error| format!("Failed to evict cached pixel payload: {error}"))?;
        remove_if_exists(&stale_paths.metadata)
            .map_err(|error| format!("Failed to evict cached metadata: {error}"))?;
        evictions += 1;
    }

    Ok(())
}

fn reconcile_cache_directory(
    cache_paths: &DecodeCachePaths,
    manifest: &mut DecodeCacheManifest,
) -> Result<(), String> {
    #[derive(Default)]
    struct DiscoveredCacheFiles {
        has_pixels: bool,
        has_metadata: bool,
    }

    let mut discovered = HashMap::<String, DiscoveredCacheFiles>::new();
    for entry in fs::read_dir(&cache_paths.dir)
        .map_err(|error| format!("Failed to read cache directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to inspect cache directory entry: {error}"))?;
        let path = entry.path();
        if path == cache_paths.manifest {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if file_name.contains(".tmp-") {
            remove_if_exists(&path)
                .map_err(|error| format!("Failed to remove stale cache temp file: {error}"))?;
            continue;
        }

        match path.extension().and_then(|extension| extension.to_str()) {
            Some("raw") => {
                let key = path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .ok_or_else(|| format!("Failed to read cache key from {}", path.display()))?;
                discovered.entry(key.to_string()).or_default().has_pixels = true;
            }
            Some("json") => {
                let key = path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .ok_or_else(|| format!("Failed to read cache key from {}", path.display()))?;
                discovered.entry(key.to_string()).or_default().has_metadata = true;
            }
            _ => {}
        }
    }

    manifest.entries.retain(|entry| {
        discovered
            .get(&entry.key)
            .is_some_and(|files| files.has_pixels && files.has_metadata)
    });
    let manifest_keys = manifest
        .entries
        .iter()
        .map(|entry| entry.key.clone())
        .collect::<HashSet<_>>();

    for (key, files) in discovered {
        let entry_paths = cache_paths.entry_paths(&key);
        if !files.has_pixels || !files.has_metadata {
            remove_if_exists(&entry_paths.pixel_bytes)
                .map_err(|error| format!("Failed to remove partial cached pixel payload: {error}"))?;
            remove_if_exists(&entry_paths.metadata)
                .map_err(|error| format!("Failed to remove partial cached metadata: {error}"))?;
            continue;
        }

        if manifest_keys.contains(&key) {
            continue;
        }

        let metadata_text = match fs::read_to_string(&entry_paths.metadata) {
            Ok(text) => text,
            Err(_) => {
                remove_if_exists(&entry_paths.pixel_bytes)
                    .map_err(|error| format!("Failed to remove unreadable cached pixel payload: {error}"))?;
                remove_if_exists(&entry_paths.metadata)
                    .map_err(|error| format!("Failed to remove unreadable cached metadata: {error}"))?;
                continue;
            }
        };
        let metadata: DecodedFrameMetadata = match serde_json::from_str(&metadata_text) {
            Ok(metadata) => metadata,
            Err(_) => {
                remove_if_exists(&entry_paths.pixel_bytes)
                    .map_err(|error| format!("Failed to remove invalid cached pixel payload: {error}"))?;
                remove_if_exists(&entry_paths.metadata)
                    .map_err(|error| format!("Failed to remove invalid cached metadata: {error}"))?;
                continue;
            }
        };
        let pixel_byte_length = match fs::metadata(&entry_paths.pixel_bytes) {
            Ok(metadata_info) => metadata_info.len() as usize,
            Err(_) => {
                remove_if_exists(&entry_paths.pixel_bytes)
                    .map_err(|error| format!("Failed to remove missing cached pixel payload: {error}"))?;
                remove_if_exists(&entry_paths.metadata)
                    .map_err(|error| format!("Failed to remove missing cached metadata: {error}"))?;
                continue;
            }
        };

        if pixel_byte_length != metadata.pixel_data_length {
            remove_if_exists(&entry_paths.pixel_bytes)
                .map_err(|error| format!("Failed to remove mismatched cached pixel payload: {error}"))?;
            remove_if_exists(&entry_paths.metadata)
                .map_err(|error| format!("Failed to remove mismatched cached metadata: {error}"))?;
            continue;
        }

        manifest.entries.push(DecodeCacheManifestEntry {
            key,
            pixel_data_length: metadata.pixel_data_length,
            last_accessed_ms: current_time_ms(),
        });
    }

    Ok(())
}

fn record_cache_touch(cache_key: &str) {
    let mut pending_touches = PENDING_CACHE_TOUCHES
        .lock()
        .expect("decode cache touches poisoned");
    pending_touches.insert(cache_key.to_string(), current_time_ms());
}

fn apply_pending_cache_touches(manifest: &mut DecodeCacheManifest) {
    let pending_touches = {
        let mut pending_touches = PENDING_CACHE_TOUCHES
            .lock()
            .expect("decode cache touches poisoned");
        std::mem::take(&mut *pending_touches)
    };

    if pending_touches.is_empty() {
        return;
    }

    for entry in &mut manifest.entries {
        if let Some(last_accessed_ms) = pending_touches.get(&entry.key) {
            entry.last_accessed_ms = entry.last_accessed_ms.max(*last_accessed_ms);
        }
    }
}

fn write_atomic_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temp_path = temporary_cache_path(path);
    fs::write(&temp_path, bytes)?;
    fs::rename(temp_path, path)
}

fn temporary_cache_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("cache-entry");
    path.with_file_name(format!(
        ".{file_name}.tmp-{}-{}",
        std::process::id(),
        current_time_ms()
    ))
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn current_time_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
fn decode_frame_impl(path: &Path, frame_index: u32) -> DecodeResult<DecodedFrame> {
    let object = open_file(path).map_err(|error| {
        DecodeError::new(
            "decode",
            format!("Failed to open DICOM file {}: {error}", path.display()),
        )
    })?;
    decode_frame_from_object(path, &object, frame_index)
}

fn decode_frame_from_object(
    path: &Path,
    object: &DefaultDicomObject,
    frame_index: u32,
) -> DecodeResult<DecodedFrame> {
    let rows = required_u16(object, tags::ROWS, "Rows")?;
    let cols = required_u16(object, tags::COLUMNS, "Columns")?;
    let bits_allocated = required_u16(object, tags::BITS_ALLOCATED, "Bits Allocated")?;
    let pixel_representation = get_u16(object, tags::PIXEL_REPRESENTATION).unwrap_or_default();
    let samples_per_pixel = get_u16(object, tags::SAMPLES_PER_PIXEL).unwrap_or(1);
    let planar_configuration = get_u16(object, tags::PLANAR_CONFIGURATION).unwrap_or(0);
    let photometric_interpretation =
        get_text(object, tags::PHOTOMETRIC_INTERPRETATION).unwrap_or_else(|| "MONOCHROME2".into());
    let frame_count = get_u32(object, tags::NUMBER_OF_FRAMES).unwrap_or(1);

    if frame_index >= frame_count {
        return Err(DecodeError::new(
            "frame-extraction",
            format!("Requested frame {frame_index} but dataset only has {frame_count} frame(s)."),
        ));
    }

    let decoded = object.decode_pixel_data_frame(frame_index).map_err(|error| {
        DecodeError::new(
            "decode",
            format!(
                "Failed to decode frame {frame_index} from {}: {error}",
                path.display()
            ),
        )
    })?;
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
            window_center: get_first_f64(object, tags::WINDOW_CENTER),
            window_width: get_first_f64(object, tags::WINDOW_WIDTH),
            rescale_slope: get_first_f64(object, tags::RESCALE_SLOPE),
            rescale_intercept: get_first_f64(object, tags::RESCALE_INTERCEPT),
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

fn required_u16(object: &DefaultDicomObject, tag: Tag, label: &str) -> DecodeResult<u16> {
    get_u16(object, tag).ok_or_else(|| {
        DecodeError::new(
            "frame-extraction",
            format!("Missing or invalid DICOM field: {label}"),
        )
    })
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

    fn test_cache_paths(label: &str) -> DecodeCachePaths {
        let unique = format!("{label}-{}-{}", std::process::id(), current_time_ms());
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).expect("test cache dir should be creatable");
        DecodeCachePaths::new(dir)
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
    fn decode_cache_reads_back_written_frames() {
        let cache_paths = test_cache_paths("decode-cache-roundtrip");
        let cache_key = "sample-frame";
        let decoded = DecodedFrame {
            metadata: DecodedFrameMetadata {
                rows: 2,
                cols: 2,
                bits_allocated: 16,
                pixel_representation: 0,
                samples_per_pixel: 1,
                planar_configuration: 0,
                photometric_interpretation: "MONOCHROME2".into(),
                window_center: Some(40.0),
                window_width: Some(400.0),
                rescale_slope: Some(1.0),
                rescale_intercept: Some(-1024.0),
                pixel_data_length: 8,
            },
            pixel_bytes: vec![1, 0, 2, 0, 3, 0, 4, 0],
        };

        write_cached_frame(&cache_paths, cache_key, &decoded).expect("cache write should succeed");
        let cached = read_cached_frame(&cache_paths, cache_key).expect("cache hit should succeed");

        assert_eq!(cached, decoded);
        assert!(cache_paths.entry_paths(cache_key).pixel_bytes.exists());
        assert!(cache_paths.entry_paths(cache_key).metadata.exists());
        assert!(cache_paths.manifest.exists());

        let _ = fs::remove_dir_all(&cache_paths.dir);
    }

    #[test]
    fn decode_cache_evicts_oldest_entries_when_limits_are_exceeded() {
        let cache_paths = test_cache_paths("decode-cache-eviction");
        let mut manifest = DecodeCacheManifest {
            entries: vec![
                DecodeCacheManifestEntry {
                    key: "oldest".into(),
                    pixel_data_length: 4,
                    last_accessed_ms: 1,
                },
                DecodeCacheManifestEntry {
                    key: "newest".into(),
                    pixel_data_length: 4,
                    last_accessed_ms: 2,
                },
            ],
        };

        for entry in &manifest.entries {
            let entry_paths = cache_paths.entry_paths(&entry.key);
            fs::write(&entry_paths.pixel_bytes, [0, 1, 2, 3]).expect("pixel payload should be written");
            fs::write(&entry_paths.metadata, "{}").expect("metadata payload should be written");
        }

        enforce_cache_limits(&cache_paths, &mut manifest, 1, 4, 1).expect("eviction should succeed");

        assert_eq!(manifest.entries.len(), 1);
        assert_eq!(manifest.entries[0].key, "newest");
        assert!(!cache_paths.entry_paths("oldest").pixel_bytes.exists());
        assert!(cache_paths.entry_paths("newest").pixel_bytes.exists());

        let _ = fs::remove_dir_all(&cache_paths.dir);
    }

    #[test]
    fn decode_frame_impl_with_cache_uses_cached_pixels_after_first_decode() {
        let fixture = fixture_path("test-fixtures/MR2_J2KI.dcm");
        let cache_paths = test_cache_paths("decode-cache-hit");

        let first = decode_frame_impl_with_cache(&fixture, 0, &cache_paths, false)
            .expect("first decode should populate cache");
        let object = open_file(&fixture).expect("fixture should be readable");
        let cache_key =
            build_cache_key(&fixture, &object, 0).expect("cache key should be computed for fixture");
        let entry_paths = cache_paths.entry_paths(&cache_key);
        let cached_bytes = vec![7; first.metadata.pixel_data_length];
        fs::write(&entry_paths.pixel_bytes, &cached_bytes).expect("cached payload should be rewritable");

        let second = decode_frame_impl_with_cache(&fixture, 0, &cache_paths, false)
            .expect("second decode should reuse cached payload");

        assert_eq!(second.pixel_bytes, cached_bytes);
        assert_eq!(second.metadata, first.metadata);

        let _ = fs::remove_dir_all(&cache_paths.dir);
    }

    #[test]
    fn decode_frame_impl_with_cache_tolerates_concurrent_writers() {
        let fixture = fixture_path("test-fixtures/MR2_J2KI.dcm");
        let cache_paths = test_cache_paths("decode-cache-concurrent");

        let mut workers = Vec::new();
        for _ in 0..4 {
            let fixture = fixture.clone();
            let cache_paths = cache_paths.clone();
            workers.push(std::thread::spawn(move || {
                decode_frame_impl_with_cache(&fixture, 0, &cache_paths, false)
            }));
        }

        let mut pixel_lengths = Vec::new();
        for worker in workers {
            let decoded = worker
                .join()
                .expect("decode worker thread should complete")
                .expect("concurrent cache decode should succeed");
            pixel_lengths.push(decoded.metadata.pixel_data_length);
        }

        assert!(pixel_lengths.iter().all(|length| *length == pixel_lengths[0]));

        let _ = fs::remove_dir_all(&cache_paths.dir);
    }

    #[test]
    fn reconcile_cache_directory_removes_orphans_and_restores_complete_pairs() {
        let cache_paths = test_cache_paths("decode-cache-reconcile");
        let complete_key = "complete";
        let orphan_raw_key = "orphan-raw";
        let orphan_json_key = "orphan-json";
        let temp_file = cache_paths.dir.join(".dangling.tmp-1-1");

        let complete_paths = cache_paths.entry_paths(complete_key);
        let orphan_raw_paths = cache_paths.entry_paths(orphan_raw_key);
        let orphan_json_paths = cache_paths.entry_paths(orphan_json_key);
        let complete_metadata = DecodedFrameMetadata {
            rows: 1,
            cols: 1,
            bits_allocated: 16,
            pixel_representation: 0,
            samples_per_pixel: 1,
            planar_configuration: 0,
            photometric_interpretation: "MONOCHROME2".into(),
            window_center: None,
            window_width: None,
            rescale_slope: None,
            rescale_intercept: None,
            pixel_data_length: 2,
        };

        fs::write(&complete_paths.pixel_bytes, [1, 0]).expect("complete payload should be written");
        fs::write(
            &complete_paths.metadata,
            serde_json::to_vec(&complete_metadata).expect("complete metadata should serialize"),
        )
        .expect("complete metadata should be written");
        fs::write(&orphan_raw_paths.pixel_bytes, [9, 9]).expect("orphan raw should be written");
        fs::write(
            &orphan_json_paths.metadata,
            serde_json::to_vec(&complete_metadata).expect("orphan metadata should serialize"),
        )
        .expect("orphan metadata should be written");
        fs::write(&temp_file, [0, 1, 2]).expect("temp file should be written");

        let mut manifest = DecodeCacheManifest::default();
        reconcile_cache_directory(&cache_paths, &mut manifest).expect("reconcile should succeed");

        assert_eq!(manifest.entries.len(), 1);
        assert_eq!(manifest.entries[0].key, complete_key);
        assert!(complete_paths.pixel_bytes.exists());
        assert!(complete_paths.metadata.exists());
        assert!(!orphan_raw_paths.pixel_bytes.exists());
        assert!(!orphan_json_paths.metadata.exists());
        assert!(!temp_file.exists());

        let _ = fs::remove_dir_all(&cache_paths.dir);
    }

    #[test]
    fn decode_frame_impl_decodes_real_jpeg2000_fixture() {
        let fixture = fixture_path("test-fixtures/MR2_J2KI.dcm");
        let decoded = decode_frame_impl(&fixture, 0).expect("fixture should decode");

        assert_eq!(decoded.metadata.rows, 1024);
        assert_eq!(decoded.metadata.cols, 1024);
        assert_eq!(decoded.metadata.bits_allocated, 16);
        assert_eq!(decoded.metadata.pixel_representation, 0);
        assert_eq!(decoded.metadata.samples_per_pixel, 1);
        assert_eq!(decoded.metadata.photometric_interpretation, "MONOCHROME2");
        assert_eq!(decoded.metadata.pixel_data_length, 1024 * 1024 * 2);
        assert_eq!(decoded.pixel_bytes.len(), decoded.metadata.pixel_data_length);
    }

    #[test]
    fn read_scan_header_impl_returns_only_the_requested_prefix() {
        let unique = format!("scan-header-{}-{}", std::process::id(), current_time_ms());
        let path = std::env::temp_dir().join(unique);
        fs::write(&path, [1, 2, 3, 4, 5, 6]).expect("scan header fixture should be written");

        let bytes = read_scan_header_impl(&path, 4).expect("partial header read should succeed");

        assert_eq!(bytes, vec![1, 2, 3, 4]);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_scan_header_impl_caps_reads_to_the_maximum_header_size() {
        let unique = format!("scan-header-cap-{}-{}", std::process::id(), current_time_ms());
        let path = std::env::temp_dir().join(unique);
        let bytes = vec![9; MAX_SCAN_HEADER_BYTES + 128];
        fs::write(&path, &bytes).expect("scan header cap fixture should be written");

        let read = read_scan_header_impl(&path, MAX_SCAN_HEADER_BYTES + 64)
            .expect("capped header read should succeed");

        assert_eq!(read.len(), MAX_SCAN_HEADER_BYTES);

        let _ = fs::remove_file(&path);
    }

}
