// IPC Bridge
function sendToRust(command, data) {
  var msg = JSON.stringify(Object.assign({ command: command }, data || {}));
  window.ipc.postMessage(msg);
}

// State
var currentPath = null;

// Rust -> JS
window.__fromRust = function(event, data) {
  switch (event) {
    case 'pdf_ready':
      currentPath = data.path;
      var url = 'http://peekpdf.localhost/pdf?t=' + Date.now();
      PdfViewer.loadPdf(url);
      updateStatusBar(data);
      setTitle(data.filename);
      sendToRust('set_title', { title: 'PeekPDF - ' + data.filename });
      break;
    case 'error':
      document.getElementById('loading-spinner').classList.remove('visible');
      showError(data.message);
      break;
  }
};

// App namespace
var App = {
  updateZoomDisplay: function(pct) {
    document.getElementById('status-zoom').textContent = pct + '%';
    showZoomToast(pct + '%');
    updateFitButtons();
  },
  updatePage: function(current, total) {
    document.getElementById('status-page').textContent =
      total > 0 ? 'Page ' + current + ' / ' + total : '';
    document.getElementById('goto-input').placeholder = current;
  },
  updateSearchCount: function(total, currentIdx) {
    var el = document.getElementById('find-count');
    if (total === 0) {
      el.textContent = document.getElementById('find-input').value ? 'No results' : '';
    } else {
      el.textContent = (currentIdx + 1) + ' of ' + total;
    }
  },
  showError: function(msg) { showError(msg); }
};

function setTitle(title) {
  document.getElementById('titlebar-title').textContent = title;
}

function updateStatusBar(data) {
  clearError();
  document.getElementById('status-filename').textContent = data.filename;
  document.getElementById('status-filesize').textContent = formatFileSize(data.file_size);
  lastNavText = data.total > 1 ? data.index + ' / ' + data.total : '';
  document.getElementById('status-nav').textContent = lastNavText;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

var errorTimer = null;
function showError(message) {
  var el = document.getElementById('status-filename');
  el.textContent = 'Error: ' + message;
  el.style.color = 'var(--danger)';
  clearTimeout(errorTimer);
  errorTimer = setTimeout(function() { el.style.color = ''; }, 5000);
}

function clearError() {
  var el = document.getElementById('status-filename');
  el.style.color = '';
  clearTimeout(errorTimer);
}

var lastNavText = '';

function requestPdf(command, data) {
  sendToRust(command, data);
}

// Zoom Toast
function showZoomToast(text) {
  var toast = document.getElementById('zoom-toast');
  toast.textContent = text;
  toast.classList.add('visible');
  clearTimeout(showZoomToast._timer);
  showZoomToast._timer = setTimeout(function() {
    toast.classList.remove('visible');
  }, 800);
}

function updateFitButtons() {
  var btnFitWidth = document.getElementById('btn-fit-width');
  var btnFitPage = document.getElementById('btn-fit-page');
  // Determined by PdfViewer internal state — we track via button clicks
}

// Find Bar
var findOpen = false;

function openFind() {
  document.getElementById('find-bar').classList.add('open');
  findOpen = true;
  var input = document.getElementById('find-input');
  input.focus();
  input.select();
  if (input.value) doSearch(input.value);
}

function closeFind() {
  document.getElementById('find-bar').classList.remove('open');
  findOpen = false;
  PdfViewer.clearSearch();
  document.getElementById('find-count').textContent = '';
}

function doSearch(term) {
  if (!term) {
    PdfViewer.clearSearch();
    document.getElementById('find-count').textContent = '';
    return;
  }
  PdfViewer.search(term);
}

document.getElementById('find-input').addEventListener('input', function() {
  doSearch(this.value);
});
document.getElementById('find-input').addEventListener('keydown', function(e) {
  if (e.key === 'Escape') { closeFind(); e.preventDefault(); }
  else if (e.key === 'Enter' && !e.shiftKey) { PdfViewer.searchNext(); e.preventDefault(); }
  else if (e.key === 'Enter' && e.shiftKey) { PdfViewer.searchPrev(); e.preventDefault(); }
});
document.getElementById('find-close').addEventListener('click', closeFind);
document.getElementById('find-next').addEventListener('click', function() { PdfViewer.searchNext(); });
document.getElementById('find-prev').addEventListener('click', function() { PdfViewer.searchPrev(); });

// TOC Sidebar
var tocOpen = false;

function toggleTOC() {
  tocOpen = !tocOpen;
  document.getElementById('toc-panel').classList.toggle('open', tocOpen);
  document.getElementById('btn-toc').classList.toggle('active', tocOpen);
  if (tocOpen) updateTOC();
}

function updateTOC() {
  var list = document.getElementById('toc-list');
  list.innerHTML = '';
  PdfViewer.getOutline(function(items) {
    if (items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = 'No outline';
      list.appendChild(empty);
      return;
    }
    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'toc-item toc-level-' + Math.min(item.level, 4);
      div.textContent = item.title;
      div.addEventListener('click', function() {
        PdfViewer.navigateToDestination(item.dest);
      });
      list.appendChild(div);
    });
  });
}

// Go-to-page input
document.getElementById('goto-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    var num = parseInt(this.value);
    if (!isNaN(num) && num > 0) {
      PdfViewer.goToPage(num);
    }
    this.value = '';
    this.blur();
  } else if (e.key === 'Escape') {
    this.value = '';
    this.blur();
  }
});

// Scroll tracking
var scrollTimer = null;
document.getElementById('viewer-container').addEventListener('scroll', function() {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(function() {
    PdfViewer.updatePageIndicator();
  }, 100);
});

// Zoom via Ctrl+scroll
document.getElementById('viewer-container').addEventListener('wheel', function(e) {
  if (e.ctrlKey) {
    e.preventDefault();
    var delta = e.deltaY < 0 ? 0.1 : -0.1;
    PdfViewer.zoomBy(delta);
    // Deactivate fit buttons on free zoom
    document.getElementById('btn-fit-width').classList.remove('active');
    document.getElementById('btn-fit-page').classList.remove('active');
  }
}, { passive: false });

// Toolbar Buttons
document.getElementById('btn-open').addEventListener('click', function() { requestPdf('open_pdf'); });
document.getElementById('btn-prev').addEventListener('click', function() {
  if (currentPath) requestPdf('prev_pdf', { path: currentPath });
});
document.getElementById('btn-next').addEventListener('click', function() {
  if (currentPath) requestPdf('next_pdf', { path: currentPath });
});
document.getElementById('btn-zoom-in').addEventListener('click', function() {
  PdfViewer.zoomBy(0.15);
  document.getElementById('btn-fit-width').classList.remove('active');
  document.getElementById('btn-fit-page').classList.remove('active');
});
document.getElementById('btn-zoom-out').addEventListener('click', function() {
  PdfViewer.zoomBy(-0.15);
  document.getElementById('btn-fit-width').classList.remove('active');
  document.getElementById('btn-fit-page').classList.remove('active');
});
document.getElementById('btn-fit-width').addEventListener('click', function() {
  PdfViewer.setZoomMode('fit-width');
  this.classList.add('active');
  document.getElementById('btn-fit-page').classList.remove('active');
});
document.getElementById('btn-fit-page').addEventListener('click', function() {
  PdfViewer.setZoomMode('fit-page');
  this.classList.add('active');
  document.getElementById('btn-fit-width').classList.remove('active');
});
document.getElementById('btn-toc').addEventListener('click', toggleTOC);

// Window Controls
document.getElementById('btn-minimize').addEventListener('click', function() { sendToRust('window_minimize'); });
document.getElementById('btn-maximize').addEventListener('click', function() { sendToRust('window_maximize'); });
document.getElementById('btn-close').addEventListener('click', function() { sendToRust('window_close'); });

// Theme
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('icon-sun').style.display = theme === 'light' ? '' : 'none';
  document.getElementById('icon-moon').style.display = theme === 'light' ? 'none' : '';
  try { localStorage.setItem('peekpdf-theme', theme); } catch(e) {}
}

document.getElementById('btn-theme').addEventListener('click', function() {
  var current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
});

// Keyboard Shortcuts
document.addEventListener('keydown', function(e) {
  // Don't intercept if typing in find-input or goto-input
  var tag = document.activeElement.tagName;
  var isInput = tag === 'INPUT';

  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    openFind();
  } else if (e.key === 'Escape' && findOpen) {
    e.preventDefault();
    closeFind();
  } else if (e.ctrlKey && e.key === 'o' && !e.shiftKey) {
    e.preventDefault();
    requestPdf('open_pdf');
  } else if (e.ctrlKey && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
    e.preventDefault();
    toggleTOC();
  } else if (e.ctrlKey && e.key === 'p') {
    e.preventDefault();
    window.print();
  } else if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    PdfViewer.zoomBy(0.15);
    document.getElementById('btn-fit-width').classList.remove('active');
    document.getElementById('btn-fit-page').classList.remove('active');
  } else if (e.ctrlKey && e.key === '-') {
    e.preventDefault();
    PdfViewer.zoomBy(-0.15);
    document.getElementById('btn-fit-width').classList.remove('active');
    document.getElementById('btn-fit-page').classList.remove('active');
  } else if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    PdfViewer.zoomTo(1);
    document.getElementById('btn-fit-width').classList.remove('active');
    document.getElementById('btn-fit-page').classList.remove('active');
  } else if (!isInput && !e.ctrlKey) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (currentPath) requestPdf('prev_pdf', { path: currentPath });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (currentPath) requestPdf('next_pdf', { path: currentPath });
    } else if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      PdfViewer.setZoomMode('fit-width');
      document.getElementById('btn-fit-width').classList.add('active');
      document.getElementById('btn-fit-page').classList.remove('active');
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      PdfViewer.setZoomMode('fit-page');
      document.getElementById('btn-fit-page').classList.add('active');
      document.getElementById('btn-fit-width').classList.remove('active');
    } else if (e.key === 'PageDown') {
      // Let default scroll work
    } else if (e.key === 'PageUp') {
      // Let default scroll work
    } else if (e.key === 'Home') {
      e.preventDefault();
      PdfViewer.goToPage(1);
    } else if (e.key === 'End') {
      e.preventDefault();
      PdfViewer.goToPage(PdfViewer.getPageCount());
    }
  }
});

// Resize handling
var resizeTimer = null;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function() {
    PdfViewer.onResize();
  }, 150);
});

// Init
document.addEventListener('DOMContentLoaded', function() {
  PdfViewer.init();
  var saved = null;
  try { saved = localStorage.getItem('peekpdf-theme'); } catch(e) {}
  if (saved) setTheme(saved);
  sendToRust('ready');
});
