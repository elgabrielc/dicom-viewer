// Copyright 2026 Divergent Health Technologies

use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// Strip a path to its filename for use in error messages (avoids leaking
/// directory structure that may contain patient names or usernames).
pub fn redact_path(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Validate that a path is non-empty and absolute, then canonicalize it.
pub fn resolve_canonical_path(path: &str, stage: &str) -> Result<PathBuf, String> {
    let requested_path = PathBuf::from(path);
    if requested_path.as_os_str().is_empty() {
        return Err(format!("{stage}: path is empty"));
    }
    if !requested_path.is_absolute() {
        return Err(format!(
            "{stage}: path must be absolute: {}",
            redact_path(path)
        ));
    }
    requested_path
        .canonicalize()
        .map_err(|error| format!("{stage}: failed to access {}: {error}", redact_path(path)))
}

/// Thread-safe set of filesystem roots that the user has authorized.
/// Every path-accepting IPC command must verify the target path falls
/// under one of these roots before proceeding.
pub struct AllowedPaths {
    roots: RwLock<Vec<PathBuf>>,
}

impl Default for AllowedPaths {
    fn default() -> Self {
        Self {
            roots: RwLock::new(Vec::new()),
        }
    }
}

impl AllowedPaths {
    /// Register a new root directory. Duplicates are silently ignored.
    pub fn add_root(&self, root: PathBuf) {
        let mut roots = self.roots.write().unwrap();
        if !roots.iter().any(|r| r == &root) {
            roots.push(root);
        }
    }

    /// Returns true if `path` is equal to or nested under any allowed root.
    pub fn is_within_scope(&self, path: &Path) -> bool {
        let roots = self.roots.read().unwrap();
        roots.iter().any(|root| path.starts_with(root))
    }
}

/// Resolve and validate that the path is within allowed scope.
/// Combines canonicalization with scope checking in a single call.
pub fn resolve_within_scope(
    path: &str,
    stage: &str,
    allowed: &AllowedPaths,
) -> Result<PathBuf, String> {
    let canonical = resolve_canonical_path(path, stage)?;
    if !allowed.is_within_scope(&canonical) {
        return Err(format!(
            "{stage}: path is outside allowed scope: {}",
            redact_path(path)
        ));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_allowed_paths_scope_check() {
        let allowed = AllowedPaths::default();
        allowed.add_root(PathBuf::from("/Users/test/scans"));

        assert!(allowed.is_within_scope(&PathBuf::from("/Users/test/scans/ct/image.dcm")));
        assert!(!allowed.is_within_scope(&PathBuf::from("/etc/passwd")));
        assert!(!allowed.is_within_scope(&PathBuf::from("/Users/test/other")));
    }

    #[test]
    fn test_allowed_paths_no_duplicates() {
        let allowed = AllowedPaths::default();
        allowed.add_root(PathBuf::from("/Users/test/scans"));
        allowed.add_root(PathBuf::from("/Users/test/scans"));
        assert_eq!(allowed.roots.read().unwrap().len(), 1);
    }

    #[test]
    fn test_resolve_within_scope_rejects_outside() {
        let allowed = AllowedPaths::default();
        allowed.add_root(PathBuf::from("/tmp"));

        let outside_path = PathBuf::from("/etc/passwd");
        assert!(!allowed.is_within_scope(&outside_path));
    }

    #[test]
    fn test_empty_roots_rejects_everything() {
        let allowed = AllowedPaths::default();
        assert!(!allowed.is_within_scope(&PathBuf::from("/any/path")));
    }

    #[test]
    fn test_multiple_roots() {
        let allowed = AllowedPaths::default();
        allowed.add_root(PathBuf::from("/Users/test/scans"));
        allowed.add_root(PathBuf::from("/Volumes/external"));

        assert!(allowed.is_within_scope(&PathBuf::from("/Users/test/scans/file.dcm")));
        assert!(allowed.is_within_scope(&PathBuf::from("/Volumes/external/data/file.dcm")));
        assert!(!allowed.is_within_scope(&PathBuf::from("/Users/test/other")));
    }

    #[test]
    fn test_exact_root_is_in_scope() {
        let allowed = AllowedPaths::default();
        allowed.add_root(PathBuf::from("/Users/test/scans"));

        // The root itself should be in scope
        assert!(allowed.is_within_scope(&PathBuf::from("/Users/test/scans")));
    }
}
