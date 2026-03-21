#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod decode;

use tauri::{
    menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime,
};
use tauri_plugin_sql::{Migration, MigrationKind};

const MENU_OPEN_FOLDER: &str = "open-folder";
const MENU_OPEN_HELP: &str = "open-help";
const EVENT_OPEN_FOLDER: &str = "desktop://open-folder";
const EVENT_OPEN_HELP: &str = "desktop://open-help";
const DESKTOP_DB_URL: &str = "sqlite:viewer.db";

fn build_menu<R: Runtime, M: Manager<R>>(manager: &M) -> tauri::Result<Menu<R>> {
    let package_info = manager.package_info();
    let config = manager.config();
    let about_metadata = AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(package_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let open_folder = MenuItemBuilder::with_id(MENU_OPEN_FOLDER, "Open Folder...")
        .accelerator("CmdOrCtrl+O")
        .build(manager)?;
    let open_help = MenuItemBuilder::with_id(MENU_OPEN_HELP, "Viewer Help").build(manager)?;
    let app_menu = SubmenuBuilder::new(manager, package_info.name.clone())
        .about(Some(about_metadata))
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
    vec![Migration {
        version: 1,
        description: "initial_schema",
        sql: include_str!("../migrations/001_initial_schema.sql"),
        kind: MigrationKind::Up,
    }]
}

fn main() {
    tauri::Builder::default()
        .manage(decode::DecodeStore::default())
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DESKTOP_DB_URL, desktop_db_migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            decode::decode_frame,
            decode::read_scan_header,
            decode::take_decoded_frame
        ])
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN_FOLDER => emit_menu_event(app, EVENT_OPEN_FOLDER),
            MENU_OPEN_HELP => emit_menu_event(app, EVENT_OPEN_HELP),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
