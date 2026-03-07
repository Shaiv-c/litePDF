use rfd::FileDialog;
use std::path::{Path, PathBuf};

const PDF_EXTENSIONS: &[&str] = &["pdf"];

pub fn pick_open_pdf() -> Option<String> {
    FileDialog::new()
        .add_filter("PDF files", PDF_EXTENSIONS)
        .add_filter("All files", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

/// Build a sorted list of PDF files in the same directory as `current_path`.
/// If `cache` is provided and the directory matches, returns the cached list.
pub fn get_pdf_list(
    current_path: &str,
    cache: Option<&(PathBuf, Vec<PathBuf>)>,
) -> Vec<PathBuf> {
    let path = Path::new(current_path);
    let dir = match path.parent() {
        Some(d) => d,
        None => return vec![path.to_path_buf()],
    };

    // Return cached list if directory matches
    if let Some((cached_dir, cached_list)) = cache {
        if cached_dir == dir {
            return cached_list.clone();
        }
    }

    let mut pdfs: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_lowercase() == "pdf")
                        .unwrap_or(false)
            })
            .collect(),
        Err(_) => return vec![path.to_path_buf()],
    };

    pdfs.sort_by(|a, b| {
        a.file_name()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .cmp(&b.file_name().unwrap_or_default().to_ascii_lowercase())
    });

    pdfs
}

fn find_index(pdfs: &[PathBuf], current_path: &str) -> Option<usize> {
    let current = Path::new(current_path);
    pdfs.iter().position(|p| p == current)
}

pub fn get_sibling_pdf(
    current_path: &str,
    direction: i32,
    cache: Option<&(PathBuf, Vec<PathBuf>)>,
) -> Option<(String, usize, usize)> {
    let pdfs = get_pdf_list(current_path, cache);
    let current_idx = find_index(&pdfs, current_path)?;
    let new_idx = if direction > 0 {
        (current_idx + 1) % pdfs.len()
    } else {
        (current_idx + pdfs.len() - 1) % pdfs.len()
    };

    Some((
        pdfs[new_idx].to_string_lossy().to_string(),
        new_idx + 1,
        pdfs.len(),
    ))
}

pub fn get_pdf_position(
    current_path: &str,
    cache: Option<&(PathBuf, Vec<PathBuf>)>,
) -> (usize, usize) {
    let pdfs = get_pdf_list(current_path, cache);
    let idx = find_index(&pdfs, current_path).unwrap_or(0);
    (idx + 1, pdfs.len())
}
