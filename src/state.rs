pub struct AppState {
    pub pdf_bytes: Option<Vec<u8>>,
    pub current_path: Option<String>,
    pub html: String,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pdf_bytes: None,
            current_path: None,
            html: String::new(),
        }
    }
}
