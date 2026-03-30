// Copyright 2026 Divergent Health Technologies

use std::path::PathBuf;

/// Validate that a path is non-empty and absolute, then canonicalize it.
pub fn resolve_canonical_path(path: &str, stage: &str) -> Result<PathBuf, String> {
    let requested_path = PathBuf::from(path);
    if requested_path.as_os_str().is_empty() {
        return Err(format!("{stage}: path is empty"));
    }
    if !requested_path.is_absolute() {
        return Err(format!("{stage}: path must be absolute: {path}"));
    }
    requested_path
        .canonicalize()
        .map_err(|error| format!("{stage}: failed to access {path}: {error}"))
}
