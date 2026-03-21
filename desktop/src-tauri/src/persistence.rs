use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

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
