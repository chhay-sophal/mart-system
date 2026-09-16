use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use std::sync::Mutex;

struct BackendPort(Mutex<Option<u16>>);

#[tauri::command]
fn get_backend_port(state: tauri::State<BackendPort>) -> Option<u16> {
  *state.0.lock().unwrap()
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
  std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn kill_backend(state: tauri::State<Mutex<Option<CommandChild>>>) {
  if let Ok(mut guard) = state.lock() {
    if let Some(child) = guard.take() {
      let _ = child.kill();
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(BackendPort(Mutex::new(None)))
    .setup(|app| {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;

      if !cfg!(debug_assertions) {
        // Kill any stale backend-server left over from a previous crash or session.
        #[cfg(target_os = "windows")]
        let _ = std::process::Command::new("taskkill")
          .args(["/F", "/IM", "backend-server-x86_64-pc-windows-msvc.exe"])
          .output();
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("pkill")
          .args(["-f", "backend-server-aarch64-apple-darwin"])
          .output();
        #[cfg(target_os = "linux")]
        let _ = std::process::Command::new("pkill")
          .args(["-f", "backend-server-x86_64-unknown-linux-gnu"])
          .output();

        let shell = app.shell();
        let (mut rx, child) = shell
          .sidecar("backend-server")
          .expect("backend-server sidecar not found")
          .spawn()
          .expect("failed to spawn backend-server");

        app.manage(Mutex::new(Some(child)));

        // Read sidecar stdout to capture the actual port it bound to.
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
          while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
              let text = String::from_utf8_lossy(&line);
              if let Some(port_str) = text.trim().strip_prefix("PORT:") {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                  if let Some(state) = app_handle.try_state::<BackendPort>() {
                    *state.0.lock().unwrap() = Some(port);
                  }
                  break;
                }
              }
            }
          }
        });
      }

      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        if let Some(state) = window.app_handle().try_state::<Mutex<Option<CommandChild>>>() {
          if let Ok(mut guard) = state.lock() {
            if let Some(child) = guard.take() {
              let _ = child.kill();
            }
          }
        }
      }
    })
    .invoke_handler(tauri::generate_handler![get_backend_port, read_file_bytes, kill_backend])
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_dialog::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
