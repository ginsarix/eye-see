mod clip;
mod engine_state;
mod fs;
mod images;
mod search;
#[cfg(test)]
mod test_support;

use engine_state::EngineState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            engine_state::load_in_background(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs::read_directory,
            fs::read_file,
            engine_state::model_state,
            search::search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
