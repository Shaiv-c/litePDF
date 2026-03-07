# PeekPDF

A lightweight, single-file PDF viewer for Windows built with Rust.

## Architecture

- **Rust backend**: tao (window management) + wry (WebView2) + rfd (file dialogs)
- **Frontend**: Vanilla HTML/CSS/JS embedded via `include_str!()`, rendered in WebView2
- **Rendering**: pdf.js v3.11.174 (IIFE build) for PDF parsing and canvas rendering
- **IPC**: JS->Rust via `window.ipc.postMessage(JSON)`, Rust->JS via `evaluate_script("window.__fromRust(...)")`

## Project Structure

```
src/
  main.rs           - Window creation, WebView setup, custom protocol, HTML assembly
  ipc.rs            - IPC message dispatch, PDF loading, folder browsing commands
  file_ops.rs       - File dialog, sibling PDF browsing
  state.rs          - AppState struct (pdf_bytes, current_path, html)
  window_state.rs   - Window position/size persistence
  frontend/
    index.html      - Shell with titlebar, find bar, TOC panel, viewer container, statusbar
    style.css       - Catppuccin dark/light themes, PDF page styles, text layer, find bar, TOC
    pdf-viewer.js   - pdf.js integration, page rendering, virtualization, search, outline
    app.js          - IPC bridge, keyboard shortcuts, UI wiring, theme, status bar
    pdf.min.js      - pdf.js library (v3.11.174, ~312 KB)
    pdf.worker.min.js - pdf.js worker (~1 MB)
```

## Key Conventions

- Custom titlebar with `decorations: false` — window controls are in HTML
- pdf.js worker is base64-encoded at build time and decoded to a Blob URL at runtime (WebView2 Workers cannot access custom protocol URLs)
- PDF bytes are served via custom protocol at `http://peekpdf.localhost/pdf`
- Page virtualization via IntersectionObserver: only visible pages (+400px buffer) are rendered, off-screen pages have canvases cleared
- Text layer uses `pdfjsLib.renderTextLayer()` for accurate text positioning and native selection
- Window state saved to `dirs::config_dir()/peekpdf/`

## Build

```
cargo build --release
```

Binary lands at `target/release/peekpdf.exe`. Optimized for size (~2 MB) via LTO, panic=abort, strip symbols.

## PDF Pipeline

1. Rust reads PDF file from disk, stores raw bytes in AppState
2. JS receives `pdf_ready` event, fetches bytes from `http://peekpdf.localhost/pdf`
3. pdf.js parses the PDF and reports page count + dimensions
4. Page placeholders are created with correct aspect ratios
5. IntersectionObserver triggers rendering of visible pages
6. Each page: canvas render at DPR-scaled resolution + text layer overlay
7. Off-screen pages are cleared to save memory
