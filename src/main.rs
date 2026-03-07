#![windows_subsystem = "windows"]

use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::WindowBuilder,
};
use wry::{WebViewBuilder, WebViewBuilderExtWindows};

mod file_ops;
mod ipc;
mod state;
mod window_state;

const INDEX_HTML: &str = include_str!("frontend/index.html");
const STYLE_CSS: &str = include_str!("frontend/style.css");
const PDF_VIEWER_JS: &str = include_str!("frontend/pdf-viewer.js");
const APP_JS: &str = include_str!("frontend/app.js");
const PDF_JS: &str = include_str!("frontend/pdf.min.js");
const PDF_WORKER_JS: &str = include_str!("frontend/pdf.worker.min.js");

#[derive(Debug)]
enum UserEvent {
    IpcMessage(String),
}

fn main() {
    let app_state = Arc::new(Mutex::new(state::AppState::new()));

    let cli_file = std::env::args().nth(1);

    let (pos, size) = window_state::load_window_state();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy: EventLoopProxy<UserEvent> = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("PeekPDF")
        .with_decorations(false)
        .with_inner_size(LogicalSize::new(size.0 as f64, size.1 as f64))
        .with_position(LogicalPosition::new(pos.0 as f64, pos.1 as f64))
        .build(&event_loop)
        .unwrap();

    let full_html = build_html();
    {
        let mut st = app_state.lock().unwrap();
        st.html = full_html;
    }

    let proxy_ipc = proxy.clone();
    let proxy_drop = proxy.clone();

    let state_proto = Arc::clone(&app_state);
    let _webview = WebViewBuilder::new()
        .with_custom_protocol("peekpdf".to_string(), move |_id, request| {
            let uri = request.uri().path();
            if uri == "/" || uri == "/index.html" {
                let st = state_proto.lock().unwrap();
                wry::http::Response::builder()
                    .header("Content-Type", "text/html")
                    .body(Cow::Owned(st.html.as_bytes().to_vec()))
                    .unwrap()
            } else if uri == "/pdf" {
                let st = state_proto.lock().unwrap();
                match &st.pdf_bytes {
                    Some(bytes) => {
                        let data = Arc::clone(bytes);
                        drop(st);
                        wry::http::Response::builder()
                            .header("Content-Type", "application/pdf")
                            .body(Cow::Owned(data.to_vec()))
                            .unwrap()
                    }
                    None => wry::http::Response::builder()
                        .status(404)
                        .body(Cow::Borrowed(b"No PDF" as &[u8]))
                        .unwrap(),
                }
            } else {
                wry::http::Response::builder()
                    .status(404)
                    .body(Cow::Borrowed(b"Not found" as &[u8]))
                    .unwrap()
            }
        })
        .with_url("http://peekpdf.localhost/")
        .with_ipc_handler(move |request| {
            let body = request.body().to_string();
            let _ = proxy_ipc.send_event(UserEvent::IpcMessage(body));
        })
        .with_new_window_req_handler(|_| false)
        .with_drag_drop_handler(move |event| {
            match event {
                wry::DragDropEvent::Enter { .. } => {
                    let msg = serde_json::json!({"command": "drag_enter"}).to_string();
                    let _ = proxy_drop.send_event(UserEvent::IpcMessage(msg));
                }
                wry::DragDropEvent::Drop { paths, .. } => {
                    let leave = serde_json::json!({"command": "drag_leave"}).to_string();
                    let _ = proxy_drop.send_event(UserEvent::IpcMessage(leave));
                    if let Some(path) = paths.first() {
                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        if ext == "pdf" {
                            let msg = serde_json::json!({
                                "command": "open_pdf",
                                "path": path.to_string_lossy()
                            })
                            .to_string();
                            let _ = proxy_drop.send_event(UserEvent::IpcMessage(msg));
                        }
                    }
                }
                wry::DragDropEvent::Leave => {
                    let msg = serde_json::json!({"command": "drag_leave"}).to_string();
                    let _ = proxy_drop.send_event(UserEvent::IpcMessage(msg));
                }
                _ => {}
            }
            true
        })
        .with_browser_accelerator_keys(false)
        .with_devtools(true)
        .build(&window)
        .expect("Failed to build WebView");

    // Store CLI file path to open once JS is ready
    if let Some(file_path) = cli_file {
        app_state.lock().unwrap().pending_file = Some(file_path);
    }

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::UserEvent(UserEvent::IpcMessage(msg)) => {
                ipc::handle_ipc_message(&msg, &_webview, &window, &app_state);
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                let inner_size = window.inner_size();
                let outer_pos = window.outer_position().unwrap_or_default();
                window_state::save_window_state(
                    (outer_pos.x, outer_pos.y),
                    (inner_size.width, inner_size.height),
                );
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}

fn escape_for_script_tag(js: &str) -> String {
    js.replace("</script", "<\\/script")
}

fn build_html() -> String {
    // Encode worker JS as base64 to avoid escaping issues in large scripts
    let worker_b64 = base64_encode(PDF_WORKER_JS.as_bytes());
    let worker_bootstrap = format!(
        "var __pdfWorkerB64=\"{}\";",
        worker_b64
    );

    let scripts = format!(
        "<script>{}</script>\n<script>{}</script>\n<script>{}</script>\n<script>{}</script>",
        escape_for_script_tag(PDF_JS),
        worker_bootstrap,
        escape_for_script_tag(PDF_VIEWER_JS),
        escape_for_script_tag(APP_JS),
    );

    INDEX_HTML
        .replace("/* __CSS__ */", STYLE_CSS)
        .replace("<!-- __SCRIPTS__ -->", &scripts)
}

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}
