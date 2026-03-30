use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanManifestEntry {
    pub path: String,
    pub name: String,
    pub root_path: String,
    pub size: u64,
    pub modified_ms: Option<i64>,
}

#[tauri::command]
pub async fn read_scan_manifest(
    roots: Vec<String>,
    max_depth: usize,
    allowed: tauri::State<'_, crate::path_util::AllowedPaths>,
) -> Result<Vec<ScanManifestEntry>, String> {
    let scoped_roots = roots
        .iter()
        .map(|root| {
            let canonical = crate::path_util::resolve_canonical_path(root, "scan-manifest")?;
            allowed.add_root(canonical.clone());
            Ok(canonical)
        })
        .collect::<Result<Vec<_>, String>>()?;

    tokio::task::spawn_blocking(move || read_scan_manifest_impl(&scoped_roots, max_depth))
        .await
        .map_err(|error| format!("Native scan manifest worker failed to join: {error}"))?
}

fn read_scan_manifest_impl(
    roots: &[PathBuf],
    max_depth: usize,
) -> Result<Vec<ScanManifestEntry>, String> {
    let mut entries = Vec::new();
    for root_path in roots {
        let metadata = fs::symlink_metadata(root_path)
            .map_err(|error| format!("scan-manifest: failed to stat {}: {error}", root_path.display()))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_file() {
            entries.push(build_manifest_entry(root_path, root_path, &metadata));
            continue;
        }
        if metadata.is_dir() {
            collect_directory_entries(root_path, root_path, 0, max_depth, &mut entries)?;
        }
    }

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn collect_directory_entries(
    root_path: &Path,
    current_path: &Path,
    depth: usize,
    max_depth: usize,
    entries: &mut Vec<ScanManifestEntry>,
) -> Result<(), String> {
    let dir = fs::read_dir(current_path).map_err(|error| {
        format!(
            "scan-manifest: failed to read directory {}: {error}",
            current_path.display()
        )
    })?;

    for dir_entry in dir {
        let dir_entry = dir_entry.map_err(|error| {
            format!(
                "scan-manifest: failed to read directory entry under {}: {error}",
                current_path.display()
            )
        })?;
        let file_type = dir_entry.file_type().map_err(|error| {
            format!(
                "scan-manifest: failed to read entry type under {}: {error}",
                current_path.display()
            )
        })?;
        if file_type.is_symlink() {
            continue;
        }

        let entry_path = dir_entry.path();
        if file_type.is_dir() {
            if depth >= max_depth {
                continue;
            }
            collect_directory_entries(root_path, &entry_path, depth + 1, max_depth, entries)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let metadata = dir_entry.metadata().map_err(|error| {
            format!(
                "scan-manifest: failed to stat {}: {error}",
                entry_path.display()
            )
        })?;
        entries.push(build_manifest_entry(root_path, &entry_path, &metadata));
    }

    Ok(())
}

fn build_manifest_entry(root_path: &Path, path: &Path, metadata: &fs::Metadata) -> ScanManifestEntry {
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64);

    ScanManifestEntry {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| path.display().to_string()),
        root_path: root_path.to_string_lossy().to_string(),
        size: metadata.len(),
        modified_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "dicom-viewer-scan-manifest-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("temp dir should be creatable");
        dir
    }

    #[test]
    fn read_scan_manifest_respects_directory_depth() {
        let root = temp_dir("depth");
        let nested = root.join("nested");
        let deep = nested.join("deep");
        fs::create_dir_all(&deep).expect("nested dirs should be creatable");
        fs::write(root.join("root.dcm"), [1_u8, 2, 3]).expect("root file should be writable");
        fs::write(nested.join("nested.dcm"), [4_u8, 5, 6]).expect("nested file should be writable");
        fs::write(deep.join("deep.dcm"), [7_u8, 8, 9]).expect("deep file should be writable");

        let shallow = read_scan_manifest_impl(std::slice::from_ref(&root), 0)
            .expect("scan manifest should succeed");
        let deep_entries = read_scan_manifest_impl(std::slice::from_ref(&root), 2)
            .expect("scan manifest should succeed");

        let shallow_paths = shallow.iter().map(|entry| entry.path.clone()).collect::<Vec<_>>();
        let deep_paths = deep_entries
            .iter()
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>();

        assert_eq!(shallow_paths, vec![root.join("root.dcm").to_string_lossy().to_string()]);
        assert_eq!(
            deep_paths,
            vec![
                root.join("nested").join("deep").join("deep.dcm").to_string_lossy().to_string(),
                root.join("nested").join("nested.dcm").to_string_lossy().to_string(),
                root.join("root.dcm").to_string_lossy().to_string(),
            ]
        );

        fs::remove_dir_all(&root).expect("temp dir should be removable");
    }
}
