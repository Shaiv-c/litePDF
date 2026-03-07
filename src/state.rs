use std::path::PathBuf;
use std::sync::Arc;

pub struct AppState {
    pub pdf_bytes: Option<Arc<Vec<u8>>>,
    pub current_path: Option<String>,
    pub html: String,
    pub pending_file: Option<String>,
    pub cached_dir: Option<(PathBuf, Vec<PathBuf>)>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pdf_bytes: None,
            current_path: None,
            html: String::new(),
            pending_file: None,
            cached_dir: None,
        }
    }
}
