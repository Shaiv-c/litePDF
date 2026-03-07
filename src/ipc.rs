use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tao::window::Window;
use wry::WebView;

use crate::file_ops;
use crate::state::AppState;

#[derive(Deserialize)]
struct IpcMessage {
    command: String,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

pub fn handle_ipc_message(
    msg: &str,
    webview: &WebView,
    window: &Window,
    state: &Arc<Mutex<AppState>>,
) {
    let parsed: IpcMessage = match serde_json::from_str(msg) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("IPC parse error: {e}");
            return;
        }
    };

    match parsed.command.as_str() {
        "open_pdf" => {
            let path = parsed.path.or_else(file_ops::pick_open_pdf);
            if let Some(p) = path {
                load_and_send_pdf(webview, &p, state);
            }
        }
        "next_pdf" => {
            if let Some(ref current) = parsed.path {
                if let Some((next, idx, total)) = file_ops::get_sibling_pdf(current, 1) {
                    load_and_send_pdf_with_pos(webview, &next, idx, total, state);
                }
            }
        }
        "prev_pdf" => {
            if let Some(ref current) = parsed.path {
                if let Some((prev, idx, total)) = file_ops::get_sibling_pdf(current, -1) {
                    load_and_send_pdf_with_pos(webview, &prev, idx, total, state);
                }
            }
        }
        "set_title" => {
            if let Some(title) = parsed.title {
                window.set_title(&title);
            }
        }
        "window_minimize" => window.set_minimized(true),
        "window_maximize" => window.set_maximized(!window.is_maximized()),
        "window_close" => {
            let inner_size = window.inner_size();
            let outer_pos = window.outer_position().unwrap_or_default();
            crate::window_state::save_window_state(
                (outer_pos.x, outer_pos.y),
                (inner_size.width, inner_size.height),
            );
            std::process::exit(0);
        }
        "drag_enter" => {
            let _ = webview.evaluate_script(
                "document.getElementById('drop-overlay').classList.add('visible')",
            );
        }
        "drag_leave" => {
            let _ = webview.evaluate_script(
                "document.getElementById('drop-overlay').classList.remove('visible')",
            );
        }
        "ready" => {}
        _ => eprintln!("Unknown IPC command: {}", parsed.command),
    }
}

fn load_and_send_pdf(webview: &WebView, path: &str, state: &Arc<Mutex<AppState>>) {
    match std::fs::read(path) {
        Ok(bytes) => {
            let file_size = bytes.len() as u64;
            {
                let mut st = state.lock().unwrap();
                st.pdf_bytes = Some(bytes);
                st.current_path = Some(path.to_string());
            }

            let (index, total) = file_ops::get_pdf_position(path);
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown");

            send_to_js(
                webview,
                "pdf_ready",
                &serde_json::json!({
                    "path": path,
                    "filename": filename,
                    "file_size": file_size,
                    "index": index,
                    "total": total,
                }),
            );
        }
        Err(e) => {
            send_to_js(
                webview,
                "error",
                &serde_json::json!({
                    "message": format!("Failed to read PDF: {}", e)
                }),
            );
        }
    }
}

fn load_and_send_pdf_with_pos(
    webview: &WebView,
    path: &str,
    index: usize,
    total: usize,
    state: &Arc<Mutex<AppState>>,
) {
    match std::fs::read(path) {
        Ok(bytes) => {
            let file_size = bytes.len() as u64;
            {
                let mut st = state.lock().unwrap();
                st.pdf_bytes = Some(bytes);
                st.current_path = Some(path.to_string());
            }

            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown");

            send_to_js(
                webview,
                "pdf_ready",
                &serde_json::json!({
                    "path": path,
                    "filename": filename,
                    "file_size": file_size,
                    "index": index,
                    "total": total,
                }),
            );
        }
        Err(e) => {
            send_to_js(
                webview,
                "error",
                &serde_json::json!({
                    "message": format!("Failed to read PDF: {}", e)
                }),
            );
        }
    }
}

fn send_to_js(webview: &WebView, event: &str, data: &serde_json::Value) {
    let script = format!(
        "window.__fromRust({}, {})",
        serde_json::to_string(event).unwrap(),
        serde_json::to_string(data).unwrap(),
    );
    let _ = webview.evaluate_script(&script);
}
