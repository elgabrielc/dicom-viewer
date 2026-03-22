use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row, SqliteConnection};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};

const CURRENT_STORE_KEY: &str = "dicom-viewer-notes-v3";
const LIBRARY_CONFIG_KEY: &str = "dicom-viewer-library-config";
const LEGACY_WEBKIT_SCAN_MAX_DEPTH: usize = 12;
const LEGACY_WEBKIT_PROFILES: &[&str] = &[
    "health.divergent.dicomviewer",
    "dicom-viewer-desktop",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceError {
    pub stage: String,
    pub message: String,
}

impl PersistenceError {
    fn new(stage: &str, message: impl Into<String>) -> Self {
        Self {
            stage: stage.to_string(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMigrationBatch {
    #[serde(default)]
    pub study_notes: Vec<StudyNoteRow>,
    #[serde(default)]
    pub series_notes: Vec<SeriesNoteRow>,
    #[serde(default)]
    pub comments: Vec<CommentRow>,
    #[serde(default)]
    pub reports: Vec<ReportRow>,
    #[serde(default)]
    pub app_config: Vec<AppConfigRow>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StudyNoteRow {
    pub study_uid: String,
    pub description: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SeriesNoteRow {
    pub study_uid: String,
    pub series_uid: String,
    pub description: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentRow {
    pub study_uid: String,
    pub series_uid: String,
    pub text: String,
    pub time: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReportRow {
    pub id: String,
    pub study_uid: String,
    pub name: String,
    pub r#type: String,
    pub size: i64,
    pub file_path: String,
    pub added_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfigRow {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDesktopBrowserStore {
    pub source_path: String,
    pub modified_ms: Option<i64>,
    pub notes_json: Option<String>,
    pub library_config_json: Option<String>,
}

fn decode_webkit_localstorage_blob(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }

    if bytes.len() % 2 == 0 {
        let utf16 = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        let utf16 = match utf16.first() {
            Some(0xfeff) => &utf16[1..],
            _ => utf16.as_slice(),
        };
        if let Ok(decoded) = String::from_utf16(utf16) {
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
    }

    String::from_utf8(bytes.to_vec())
        .ok()
        .filter(|decoded| !decoded.is_empty())
}

fn modified_ms(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
}

fn collect_localstorage_dbs(root: &Path, depth: usize, found: &mut BTreeSet<PathBuf>) {
    if depth > LEGACY_WEBKIT_SCAN_MAX_DEPTH {
        return;
    }

    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }

        if metadata.is_dir() {
            if depth < LEGACY_WEBKIT_SCAN_MAX_DEPTH {
                collect_localstorage_dbs(&path, depth + 1, found);
            }
            continue;
        }

        if metadata.is_file()
            && path.file_name().and_then(|name| name.to_str()) == Some("localstorage.sqlite3")
        {
            found.insert(path);
        }
    }
}

fn sort_localstorage_db_paths(db_paths: BTreeSet<PathBuf>) -> Vec<PathBuf> {
    let mut ordered = db_paths
        .into_iter()
        .map(|path| (modified_ms(&path), path))
        .collect::<Vec<_>>();

    // Oldest-to-newest preserves deterministic ordering while letting the most
    // recently written store win when JS upserts later rows over earlier ones.
    ordered.sort_by(|(modified_a, path_a), (modified_b, path_b)| {
        modified_a.cmp(modified_b).then_with(|| path_a.cmp(path_b))
    });

    ordered.into_iter().map(|(_, path)| path).collect()
}

fn legacy_webkit_roots(app: &AppHandle) -> Vec<PathBuf> {
    let home_dir = match app.path().home_dir() {
        Ok(path) => path,
        Err(_) => return Vec::new(),
    };

    let webkit_root = home_dir.join("Library").join("WebKit");
    LEGACY_WEBKIT_PROFILES
        .iter()
        .map(|profile| webkit_root.join(profile))
        .filter(|path| path.exists())
        .collect()
}

async fn read_legacy_browser_store_from_db(path: &Path) -> Option<LegacyDesktopBrowserStore> {
    let connect_options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .read_only(true);

    let mut connection = match SqliteConnection::connect_with(&connect_options).await {
        Ok(connection) => connection,
        Err(_) => return None,
    };

    let rows = match sqlx::query("SELECT key, value FROM ItemTable WHERE key IN (?, ?)")
        .bind(CURRENT_STORE_KEY)
        .bind(LIBRARY_CONFIG_KEY)
        .fetch_all(&mut connection)
        .await
    {
        Ok(rows) => rows,
        Err(_) => return None,
    };

    let mut notes_json = None;
    let mut library_config_json = None;
    for row in rows {
        let key = match row.try_get::<String, _>("key") {
            Ok(key) => key,
            Err(_) => continue,
        };
        let value = match row.try_get::<Vec<u8>, _>("value") {
            Ok(value) => value,
            Err(_) => continue,
        };
        let decoded = match decode_webkit_localstorage_blob(&value) {
            Some(decoded) => decoded,
            None => continue,
        };

        match key.as_str() {
            CURRENT_STORE_KEY => notes_json = Some(decoded),
            LIBRARY_CONFIG_KEY => library_config_json = Some(decoded),
            _ => {}
        }
    }

    if notes_json.is_none() && library_config_json.is_none() {
        return None;
    }

    Some(LegacyDesktopBrowserStore {
        source_path: path.to_string_lossy().into_owned(),
        modified_ms: modified_ms(path),
        notes_json,
        library_config_json,
    })
}

#[tauri::command]
pub async fn apply_desktop_migration(
    db: String,
    batch: DesktopMigrationBatch,
    db_instances: State<'_, DbInstances>,
) -> Result<bool, PersistenceError> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(&db) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            None => {
                return Err(PersistenceError::new(
                    "desktop-migration",
                    format!("Database is not loaded: {db}"),
                ));
            }
        }
    };

    let mut tx = pool.begin().await.map_err(|error| {
        PersistenceError::new(
            "desktop-migration",
            format!("Failed to begin desktop migration transaction: {error}"),
        )
    })?;

    for row in &batch.study_notes {
        sqlx::query(
            r#"INSERT INTO study_notes (study_uid, description, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(study_uid) DO NOTHING"#,
        )
        .bind(&row.study_uid)
        .bind(&row.description)
        .bind(row.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            PersistenceError::new(
                "desktop-migration",
                format!("Failed to import study note {}: {error}", row.study_uid),
            )
        })?;
    }

    for row in &batch.series_notes {
        sqlx::query(
            r#"INSERT INTO series_notes (study_uid, series_uid, description, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(study_uid, series_uid) DO NOTHING"#,
        )
        .bind(&row.study_uid)
        .bind(&row.series_uid)
        .bind(&row.description)
        .bind(row.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            PersistenceError::new(
                "desktop-migration",
                format!(
                    "Failed to import series note {} / {}: {error}",
                    row.study_uid, row.series_uid
                ),
            )
        })?;
    }

    for row in &batch.comments {
        sqlx::query(
            r#"INSERT OR IGNORE INTO comments (study_uid, series_uid, text, time)
               VALUES (?, ?, ?, ?)"#,
        )
        .bind(&row.study_uid)
        .bind(&row.series_uid)
        .bind(&row.text)
        .bind(row.time)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            PersistenceError::new(
                "desktop-migration",
                format!("Failed to import comment for {}: {error}", row.study_uid),
            )
        })?;
    }

    for row in &batch.reports {
        sqlx::query(
            r#"INSERT INTO reports (id, study_uid, name, type, size, file_path, added_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                   study_uid = excluded.study_uid,
                   name = excluded.name,
                   type = excluded.type,
                   size = excluded.size,
                   file_path = excluded.file_path,
                   added_at = excluded.added_at,
                   updated_at = excluded.updated_at"#,
        )
        .bind(&row.id)
        .bind(&row.study_uid)
        .bind(&row.name)
        .bind(&row.r#type)
        .bind(row.size)
        .bind(&row.file_path)
        .bind(row.added_at)
        .bind(row.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            PersistenceError::new(
                "desktop-migration",
                format!("Failed to import report {}: {error}", row.id),
            )
        })?;
    }

    for row in &batch.app_config {
        sqlx::query(
            r#"INSERT INTO app_config (key, value, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                   value = excluded.value,
                   updated_at = excluded.updated_at"#,
        )
        .bind(&row.key)
        .bind(&row.value)
        .bind(row.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            PersistenceError::new(
                "desktop-migration",
                format!("Failed to import app config {}: {error}", row.key),
            )
        })?;
    }

    tx.commit().await.map_err(|error| {
        PersistenceError::new(
            "desktop-migration",
            format!("Failed to commit desktop migration transaction: {error}"),
        )
    })?;

    Ok(true)
}

#[tauri::command]
pub async fn load_legacy_desktop_browser_stores(
    app: AppHandle,
) -> Result<Vec<LegacyDesktopBrowserStore>, PersistenceError> {
    let mut db_paths = BTreeSet::new();
    for root in legacy_webkit_roots(&app) {
        let metadata = match fs::symlink_metadata(&root) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            continue;
        }
        collect_localstorage_dbs(&root, 0, &mut db_paths);
    }

    let mut stores = Vec::new();
    for db_path in sort_localstorage_db_paths(db_paths) {
        if let Some(store) = read_legacy_browser_store_from_db(&db_path).await {
            stores.push(store);
        }
    }

    Ok(stores)
}

#[cfg(test)]
mod tests {
    use super::{
        collect_localstorage_dbs, decode_webkit_localstorage_blob, modified_ms,
        sort_localstorage_db_paths, LEGACY_WEBKIT_SCAN_MAX_DEPTH,
    };
    use std::{collections::BTreeSet, fs, path::PathBuf, time::{Duration, SystemTime, UNIX_EPOCH}};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "dicom-viewer-persistence-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be valid")
                .as_nanos()
        ));
        fs::create_dir_all(&dir).expect("temp dir should be creatable");
        dir
    }

    #[test]
    fn decodes_utf16le_webkit_localstorage_values() {
        let bytes = "hello world"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect::<Vec<_>>();

        assert_eq!(
            decode_webkit_localstorage_blob(&bytes).as_deref(),
            Some("hello world")
        );
    }

    #[test]
    fn decodes_utf8_fallback_values() {
        assert_eq!(
            decode_webkit_localstorage_blob(br#"{"folder":"/tmp"}"#).as_deref(),
            Some(r#"{"folder":"/tmp"}"#)
        );
    }

    #[test]
    fn collect_localstorage_dbs_respects_depth_cap() {
        let root = temp_dir("depth-cap");
        let mut current = root.clone();
        for index in 0..=LEGACY_WEBKIT_SCAN_MAX_DEPTH {
            current = current.join(format!("level-{index}"));
            fs::create_dir_all(&current).expect("nested dirs should be creatable");
        }
        let too_deep = current.join("localstorage.sqlite3");
        fs::write(&too_deep, b"noop").expect("sqlite file should be writable");

        let mut found = BTreeSet::new();
        collect_localstorage_dbs(&root, 0, &mut found);

        assert!(found.is_empty());

        fs::remove_dir_all(root).expect("temp dir should be removable");
    }

    #[cfg(unix)]
    #[test]
    fn collect_localstorage_dbs_skips_symlink_loops() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("symlink-loop");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("nested dir should be creatable");
        let sqlite = nested.join("localstorage.sqlite3");
        fs::write(&sqlite, b"noop").expect("sqlite file should be writable");
        symlink(&root, nested.join("loop")).expect("symlink should be creatable");

        let mut found = BTreeSet::new();
        collect_localstorage_dbs(&root, 0, &mut found);

        assert_eq!(found.into_iter().collect::<Vec<_>>(), vec![sqlite]);

        fs::remove_dir_all(root).expect("temp dir should be removable");
    }

    #[test]
    fn sort_localstorage_db_paths_prefers_newer_entries_last() {
        let root = temp_dir("sort");
        let older = root.join("a.sqlite3");
        let newer = root.join("b.sqlite3");
        fs::write(&older, b"older").expect("older file should be writable");
        std::thread::sleep(Duration::from_millis(5));
        fs::write(&newer, b"newer").expect("newer file should be writable");

        let ordered = sort_localstorage_db_paths(BTreeSet::from([newer.clone(), older.clone()]));

        assert_eq!(ordered, vec![older.clone(), newer.clone()]);
        assert!(modified_ms(&newer).unwrap_or_default() >= modified_ms(&older).unwrap_or_default());

        fs::remove_dir_all(root).expect("temp dir should be removable");
    }
}
