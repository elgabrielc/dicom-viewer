#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod decode;
mod path_util;
mod persistence;
mod scan;
mod secure_store;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime, State,
};
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn reveal_in_finder(
    path: String,
    allowed: State<'_, path_util::AllowedPaths>,
) -> Result<(), String> {
    let canonical = crate::path_util::resolve_canonical_path(&path, "reveal")?;
    if !allowed.is_within_scope(&canonical) {
        return Err("reveal: path is outside allowed scope".into());
    }
    let meta = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::process::Command::new("open")
            .arg(&canonical)
            .spawn()
            .map_err(|e| e.to_string())?;
    } else {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&canonical)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

const MENU_OPEN_FOLDER: &str = "open-folder";
const MENU_SHOW_LIBRARY: &str = "show-library-in-finder";
const MENU_CHECK_UPDATES: &str = "check-for-updates";
const MENU_OPEN_HELP: &str = "open-help";
const EVENT_OPEN_FOLDER: &str = "desktop://open-folder";
const EVENT_SHOW_LIBRARY: &str = "desktop://show-library-in-finder";
const EVENT_CHECK_UPDATES: &str = "desktop://check-for-updates";
const EVENT_OPEN_HELP: &str = "desktop://open-help";
const DESKTOP_DB_URL: &str = "sqlite:viewer.db";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugSettings {
    pub decode_mode: String,
    pub preload_mode: String,
    pub frontend_decode_trace: bool,
    pub native_decode_debug: bool,
}

impl Default for DebugSettings {
    fn default() -> Self {
        Self {
            decode_mode: "auto".into(),
            preload_mode: "auto".into(),
            frontend_decode_trace: false,
            native_decode_debug: false,
        }
    }
}

fn parse_debug_settings() -> DebugSettings {
    let mut settings = DebugSettings::default();
    let args: Vec<String> = std::env::args().collect();
    let mut index = 1;

    while index < args.len() {
        match args[index].as_str() {
            "--decode-mode" => {
                if let Some(value) = args.get(index + 1) {
                    match value.as_str() {
                        "auto" | "js" | "native" => {
                            settings.decode_mode = value.clone();
                            index += 1;
                        }
                        other => {
                            eprintln!(
                                "[desktop-debug] ignoring unsupported decode mode argument: {other}"
                            );
                        }
                    }
                }
            }
            "--preload-mode" => {
                if let Some(value) = args.get(index + 1) {
                    match value.as_str() {
                        "auto" | "on" | "off" => {
                            settings.preload_mode = value.clone();
                            index += 1;
                        }
                        other => {
                            eprintln!(
                                "[desktop-debug] ignoring unsupported preload mode argument: {other}"
                            );
                        }
                    }
                }
            }
            "--decode-debug" | "--native-decode-debug" => {
                settings.native_decode_debug = true;
            }
            "--decode-trace" | "--frontend-decode-trace" => {
                settings.frontend_decode_trace = true;
            }
            _ => {}
        }
        index += 1;
    }

    settings
}

#[tauri::command]
fn get_debug_settings(settings: tauri::State<'_, DebugSettings>) -> DebugSettings {
    settings.inner().clone()
}

#[tauri::command]
fn log_frontend_decode_event(settings: tauri::State<'_, DebugSettings>, message: String) {
    if settings.frontend_decode_trace {
        eprintln!("[frontend-decode] {message}");
    }
}

fn build_menu<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<Menu<R>> {
    let package_info = manager.package_info();
    let config = manager.config();
    let display_name = String::from("myradone");
    let about_metadata = AboutMetadata {
        name: Some(display_name.clone()),
        version: Some(package_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let open_folder = MenuItemBuilder::with_id(MENU_OPEN_FOLDER, "Import Folder...")
        .accelerator("CmdOrCtrl+O")
        .build(manager)?;
    let show_library =
        MenuItemBuilder::with_id(MENU_SHOW_LIBRARY, "Show Library in Finder").build(manager)?;
    let open_help = MenuItemBuilder::with_id(MENU_OPEN_HELP, "Viewer Help").build(manager)?;
    let check_updates =
        MenuItemBuilder::with_id(MENU_CHECK_UPDATES, "Check for Updates...").build(manager)?;
    let app_menu = SubmenuBuilder::new(manager, &display_name)
        .about(Some(about_metadata))
        .separator()
        .item(&check_updates)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(manager, "File")
        .item(&open_folder)
        .item(&PredefinedMenuItem::separator(manager)?)
        .item(&show_library)
        .separator()
        .close_window()
        .build()?;
    let edit_menu = SubmenuBuilder::new(manager, "Edit")
        .copy()
        .select_all()
        .build()?;
    let window_menu = SubmenuBuilder::new(manager, "Window")
        .minimize()
        .maximize()
        .fullscreen()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(manager, "Help")
        .item(&open_help)
        .build()?;

    Menu::with_items(
        manager,
        &[&app_menu, &file_menu, &edit_menu, &window_menu, &help_menu],
    )
}

fn emit_menu_event<R: Runtime>(app: &AppHandle<R>, event_name: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event_name, ());
    }
}

fn desktop_db_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_schema",
            sql: include_str!("../migrations/001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "scan_cache_compat",
            sql: include_str!("../migrations/002_scan_cache.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "comments_sync",
            sql: include_str!("../migrations/003_comments_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "study_notes_sync",
            sql: include_str!("../migrations/004_study_notes_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "reports_sync",
            sql: include_str!("../migrations/005_reports_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "sync_core",
            sql: include_str!("../migrations/006_sync_core.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "import_tracking",
            sql: include_str!("../migrations/007_import_tracking.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "instrumentation",
            sql: include_str!("../migrations/008_instrumentation.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(target_os = "macos")]
const MACOS_ICON_REFRESH_MAX_ATTEMPTS: u32 = 3;
#[cfg(target_os = "macos")]
const MACOS_ICON_REFRESH_VERSION_FILE: &str = ".last_lsregister_version";
#[cfg(target_os = "macos")]
const MACOS_ICON_REFRESH_ATTEMPT_FILE: &str = ".lsregister_attempt_state.json";

#[cfg(target_os = "macos")]
#[derive(Debug, Default, Deserialize, Serialize)]
struct MacosIconRefreshAttemptState {
    version: String,
    attempts: u32,
}

#[cfg(target_os = "macos")]
fn read_macos_icon_refresh_attempt_state(path: &std::path::Path) -> MacosIconRefreshAttemptState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
fn write_macos_icon_refresh_attempt_state(
    path: &std::path::Path,
    state: &MacosIconRefreshAttemptState,
) -> std::io::Result<()> {
    let json = serde_json::to_vec(state).map_err(std::io::Error::other)?;
    std::fs::write(path, json)
}

#[cfg(target_os = "macos")]
fn maybe_refresh_macos_icon_registration<R: Runtime, M: Manager<R>>(manager: &M) {
    let current_version = manager.package_info().version.to_string();
    let app_data = match manager.path().app_data_dir() {
        Ok(path) => path,
        Err(error) => {
            eprintln!(
                "[desktop-updater] BUG-009: unable to resolve app data dir for icon refresh: {error}"
            );
            return;
        }
    };
    let version_file = app_data.join(MACOS_ICON_REFRESH_VERSION_FILE);
    let last_version = std::fs::read_to_string(&version_file).unwrap_or_default();
    if last_version.trim() == current_version {
        return;
    }
    let attempt_file = app_data.join(MACOS_ICON_REFRESH_ATTEMPT_FILE);
    let attempt_state = read_macos_icon_refresh_attempt_state(&attempt_file);
    if attempt_state.version == current_version
        && attempt_state.attempts >= MACOS_ICON_REFRESH_MAX_ATTEMPTS
    {
        eprintln!(
            "[desktop-updater] BUG-009: skipping lsregister after {} failed attempts for version {}",
            attempt_state.attempts,
            current_version
        );
        return;
    }
    let next_attempt = if attempt_state.version == current_version {
        attempt_state.attempts.saturating_add(1)
    } else {
        1
    };

    let exe = match std::env::current_exe() {
        Ok(path) => path,
        Err(error) => {
            eprintln!(
                "[desktop-updater] BUG-009: unable to resolve current executable for icon refresh: {error}"
            );
            return;
        }
    };
    let Some(bundle) = exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
    else {
        eprintln!(
            "[desktop-updater] BUG-009: unable to resolve .app bundle from executable path {}",
            exe.display()
        );
        return;
    };

    if bundle.extension().and_then(|ext| ext.to_str()) != Some("app") || !bundle.is_dir() {
        return;
    }

    // BUG-009: Best-effort workaround for stale macOS app icons after updater installs.
    // `lsregister -f` re-registers the bundle with LaunchServices, which may prompt
    // Icon Services to re-read the .icns after a version change. This is not a
    // guaranteed cache flush, so we run it in the background with a per-version
    // retry cap and persist success only after the command completes.
    if let Err(error) = std::fs::create_dir_all(&app_data) {
        eprintln!(
            "[desktop-updater] BUG-009: unable to create app data dir for retry state: {error}"
        );
    } else {
        let next_state = MacosIconRefreshAttemptState {
            version: current_version.clone(),
            attempts: next_attempt,
        };
        if let Err(error) = write_macos_icon_refresh_attempt_state(&attempt_file, &next_state) {
            eprintln!(
                "[desktop-updater] BUG-009: unable to persist lsregister retry state: {error}"
            );
        }
    }

    let candidates = [
        "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister",
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ];
    let Some(lsregister) = candidates
        .into_iter()
        .find(|path| std::path::Path::new(path).exists())
    else {
        eprintln!(
            "[desktop-updater] BUG-009: lsregister binary not found on attempt {} of {}",
            next_attempt, MACOS_ICON_REFRESH_MAX_ATTEMPTS
        );
        return;
    };

    let app_data = app_data.clone();
    let attempt_file = attempt_file.clone();
    let bundle = bundle.to_path_buf();
    let current_version = current_version.clone();
    let lsregister = String::from(lsregister);
    let version_file = version_file.clone();

    if let Err(error) = std::thread::Builder::new()
        .name(String::from("macos-icon-refresh"))
        .spawn(move || {
            match std::process::Command::new(&lsregister)
                .arg("-f")
                .arg(&bundle)
                .output()
            {
                Ok(output) if output.status.success() => {
                    eprintln!(
                        "[desktop-updater] BUG-009: lsregister -f succeeded for {}",
                        bundle.display()
                    );
                    if let Err(error) = std::fs::create_dir_all(&app_data) {
                        eprintln!(
                            "[desktop-updater] BUG-009: unable to create app data dir after lsregister success: {error}"
                        );
                        return;
                    }
                    if let Err(error) = std::fs::write(&version_file, &current_version) {
                        eprintln!(
                            "[desktop-updater] BUG-009: lsregister succeeded but failed to persist version gate: {error}"
                        );
                        return;
                    }
                    let _ = std::fs::remove_file(&attempt_file);
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    eprintln!(
                        "[desktop-updater] BUG-009: lsregister -f attempt {} of {} exited {} for {}: {}",
                        next_attempt,
                        MACOS_ICON_REFRESH_MAX_ATTEMPTS,
                        output.status,
                        bundle.display(),
                        stderr.trim()
                    );
                }
                Err(error) => {
                    eprintln!(
                        "[desktop-updater] BUG-009: failed to run lsregister -f attempt {} of {}: {}",
                        next_attempt,
                        MACOS_ICON_REFRESH_MAX_ATTEMPTS,
                        error
                    );
                }
            }
        })
    {
        eprintln!(
            "[desktop-updater] BUG-009: unable to spawn background lsregister thread: {error}"
        );
    }
}

fn main() {
    let debug_settings = parse_debug_settings();
    if debug_settings.decode_mode != "auto"
        || debug_settings.preload_mode != "auto"
        || debug_settings.frontend_decode_trace
        || debug_settings.native_decode_debug
    {
        eprintln!(
            "[desktop-debug] decode_mode={} preload_mode={} frontend_decode_trace={} native_decode_debug={}",
            debug_settings.decode_mode,
            debug_settings.preload_mode,
            debug_settings.frontend_decode_trace,
            debug_settings.native_decode_debug
        );
    }

    tauri::Builder::default()
        .manage(decode::DecodeStore::default())
        .manage(path_util::AllowedPaths::default())
        .manage(debug_settings)
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;

            // Register $APPDATA as an always-allowed root so desktop
            // persistence (decode cache, database, etc.) works without
            // the user explicitly selecting it via a file dialog.
            let allowed = app.state::<path_util::AllowedPaths>();
            if let Ok(app_data) = app.path().app_data_dir() {
                if let Ok(canonical) = app_data.canonicalize() {
                    allowed.add_root(canonical);
                } else {
                    // App data dir may not exist yet on first launch
                    let _ = std::fs::create_dir_all(&app_data);
                    if let Ok(canonical) = app_data.canonicalize() {
                        allowed.add_root(canonical);
                    }
                }
            }

            #[cfg(target_os = "macos")]
            maybe_refresh_macos_icon_registration(app);

            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DESKTOP_DB_URL, desktop_db_migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_debug_settings,
            log_frontend_decode_event,
            decode::decode_frame,
            decode::decode_frame_with_pixels,
            decode::take_decoded_frame,
            decode::read_scan_header,
            persistence::apply_desktop_migration,
            persistence::load_legacy_desktop_browser_stores,
            scan::read_scan_manifest,
            secure_store::load_secure_auth_state,
            secure_store::store_secure_auth_state,
            secure_store::clear_secure_auth_state,
            reveal_in_finder
        ])
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN_FOLDER => emit_menu_event(app, EVENT_OPEN_FOLDER),
            MENU_SHOW_LIBRARY => emit_menu_event(app, EVENT_SHOW_LIBRARY),
            MENU_CHECK_UPDATES => emit_menu_event(app, EVENT_CHECK_UPDATES),
            MENU_OPEN_HELP => emit_menu_event(app, EVENT_OPEN_HELP),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
