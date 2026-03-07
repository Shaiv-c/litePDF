// PDF Viewer — pdf.js integration, rendering, virtualization, search, outline
var PdfViewer = (function() {
  var pdfDoc = null;
  var pageCount = 0;
  var pages = []; // { div, canvas, textLayer, rendered, rendering, visible, baseWidth, baseHeight, pageTextContent }
  var currentScale = 1;
  var zoomMode = 'fit-width'; // 'fit-width', 'fit-page', 'free'
  var dpr = window.devicePixelRatio || 1;
  var observer = null;
  var container = null;
  var viewer = null;
  var searchState = { flatMatches: [], current: -1, query: '', pageTexts: [] };

  // Create worker from embedded base64
  (function() {
    var b64 = window.__pdfWorkerB64;
    if (b64) {
      var raw = atob(b64);
      var arr = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      var blob = new Blob([arr], { type: 'application/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    }
  })();

  function init() {
    container = document.getElementById('viewer-container');
    viewer = document.getElementById('pdf-viewer');
    observer = new IntersectionObserver(onIntersection, {
      root: container,
      rootMargin: '400px 0px'
    });
  }

  function onIntersection(entries) {
    entries.forEach(function(entry) {
      var pageIdx = parseInt(entry.target.dataset.page);
      if (entry.isIntersecting) {
        renderPage(pageIdx);
      } else {
        clearPage(pageIdx);
      }
    });
  }

  function loadPdf(url) {
    cleanup();
    document.getElementById('loading-spinner').classList.add('visible');

    var loadingTask = pdfjsLib.getDocument(url);
    loadingTask.promise.then(function(pdf) {
      pdfDoc = pdf;
      pageCount = pdf.numPages;
      document.getElementById('loading-spinner').classList.remove('visible');
      createPagePlaceholders();
      // Get first page viewport to set initial scale
      pdfDoc.getPage(1).then(function(page) {
        var vp = page.getViewport({ scale: 1 });
        pages[0].baseWidth = vp.width;
        pages[0].baseHeight = vp.height;
        updateFitScale();
        updatePageSize(0);
        viewer.classList.add('active');
        document.getElementById('welcome-panel').style.display = 'none';
        container.scrollTop = 0;
        pages.forEach(function(p) { observer.observe(p.div); });
        updatePageIndicator();
      });
      // Pre-fetch remaining page viewports
      for (var i = 1; i < pageCount; i++) {
        (function(idx) {
          pdfDoc.getPage(idx + 1).then(function(page) {
            var vp = page.getViewport({ scale: 1 });
            pages[idx].baseWidth = vp.width;
            pages[idx].baseHeight = vp.height;
            updatePageSize(idx);
          });
        })(i);
      }
    }).catch(function(err) {
      document.getElementById('loading-spinner').classList.remove('visible');
      var msg = err && err.message ? err.message : String(err);
      if (msg.indexOf('password') !== -1 || msg.indexOf('Password') !== -1) {
        msg = 'This PDF is password-protected';
      }
      if (window.App) App.showError(msg);
    });
  }

  function cleanup() {
    if (observer) {
      pages.forEach(function(p) { observer.unobserve(p.div); });
    }
    pages = [];
    pdfDoc = null;
    pageCount = 0;
    viewer.innerHTML = '';
    viewer.classList.remove('active');
    searchState = { flatMatches: [], current: -1, query: '', pageTexts: [] };
  }

  function createPagePlaceholders() {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < pageCount; i++) {
      var div = document.createElement('div');
      div.className = 'pdf-page';
      div.dataset.page = i;
      div.style.width = '612px';
      div.style.height = '792px';

      var canvas = document.createElement('canvas');
      div.appendChild(canvas);

      var textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      div.appendChild(textLayer);

      fragment.appendChild(div);
      pages.push({
        div: div,
        canvas: canvas,
        textLayer: textLayer,
        rendered: false,
        rendering: false,
        visible: false,
        baseWidth: 612,
        baseHeight: 792,
        textDivs: []
      });
    }
    viewer.appendChild(fragment);
  }

  function updatePageSize(idx) {
    var p = pages[idx];
    var w = Math.floor(p.baseWidth * currentScale);
    var h = Math.floor(p.baseHeight * currentScale);
    p.div.style.width = w + 'px';
    p.div.style.height = h + 'px';
  }

  function renderPage(idx) {
    var p = pages[idx];
    if (!pdfDoc || p.rendering || p.rendered) return;
    p.visible = true;
    if (!p.baseWidth) return;
    p.rendering = true;

    pdfDoc.getPage(idx + 1).then(function(page) {
      var viewport = page.getViewport({ scale: currentScale * dpr });
      var displayViewport = page.getViewport({ scale: currentScale });
      var canvas = p.canvas;
      var ctx = canvas.getContext('2d');

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = Math.floor(displayViewport.width) + 'px';
      canvas.style.height = Math.floor(displayViewport.height) + 'px';

      page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function() {
        p.rendered = true;
        p.rendering = false;
        buildTextLayer(page, displayViewport, p, idx);
      }).catch(function() {
        p.rendering = false;
      });
    });
  }

  function buildTextLayer(page, viewport, p, idx) {
    p.textLayer.innerHTML = '';
    p.textDivs = [];
    var w = Math.floor(viewport.width);
    var h = Math.floor(viewport.height);
    p.textLayer.style.width = w + 'px';
    p.textLayer.style.height = h + 'px';

    page.getTextContent().then(function(textContent) {
      var textDivs = [];
      var task = pdfjsLib.renderTextLayer({
        textContent: textContent,
        container: p.textLayer,
        viewport: viewport,
        textDivs: textDivs
      });
      task.promise.then(function() {
        p.textDivs = textDivs;
        if (searchState.query) highlightPageMatches(idx);
      }).catch(function() {});
    });
  }

  function clearPage(idx) {
    var p = pages[idx];
    p.visible = false;
    if (!p.rendered) return;
    var ctx = p.canvas.getContext('2d');
    ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
    p.canvas.width = 1;
    p.canvas.height = 1;
    p.textLayer.innerHTML = '';
    p.textDivs = [];
    p.rendered = false;
  }

  function updateFitScale() {
    if (!pageCount || !pages[0]) return;
    var scrollbarW = container.offsetWidth - container.clientWidth;
    var containerWidth = container.clientWidth - 24;
    var containerHeight = container.clientHeight - 24;
    var pw = pages[0].baseWidth || 612;
    var ph = pages[0].baseHeight || 792;

    if (zoomMode === 'fit-width') {
      currentScale = containerWidth / pw;
    } else if (zoomMode === 'fit-page') {
      var scaleW = containerWidth / pw;
      var scaleH = containerHeight / ph;
      currentScale = Math.min(scaleW, scaleH);
    }
    applyScale();
  }

  function setZoomMode(mode) {
    zoomMode = mode;
    updateFitScale();
  }

  function zoomTo(scale) {
    zoomMode = 'free';
    currentScale = Math.max(0.25, Math.min(5, scale));
    applyScale();
  }

  function zoomBy(delta) {
    zoomTo(currentScale + delta);
  }

  function applyScale() {
    dpr = window.devicePixelRatio || 1;
    var scrollRatio = container.scrollHeight > container.clientHeight
      ? container.scrollTop / (container.scrollHeight - container.clientHeight) : 0;

    for (var i = 0; i < pages.length; i++) {
      updatePageSize(i);
      if (pages[i].rendered) {
        pages[i].rendered = false;
        pages[i].canvas.width = 1;
        pages[i].canvas.height = 1;
        pages[i].textLayer.innerHTML = '';
        pages[i].textDivs = [];
      }
    }

    requestAnimationFrame(function() {
      container.scrollTop = scrollRatio * (container.scrollHeight - container.clientHeight);
      pages.forEach(function(p) {
        observer.unobserve(p.div);
        observer.observe(p.div);
      });
    });

    if (window.App) App.updateZoomDisplay(Math.round(currentScale * 100));
  }

  function getScale() { return currentScale; }
  function getPageCount() { return pageCount; }

  function getCurrentPage() {
    if (!pageCount) return 0;
    var containerRect = container.getBoundingClientRect();
    var midY = containerRect.top + containerRect.height / 2;
    for (var i = 0; i < pages.length; i++) {
      var rect = pages[i].div.getBoundingClientRect();
      if (rect.top <= midY && rect.bottom >= midY) return i + 1;
    }
    for (var i = 0; i < pages.length; i++) {
      var rect = pages[i].div.getBoundingClientRect();
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) return i + 1;
    }
    return 1;
  }

  function goToPage(num) {
    num = Math.max(1, Math.min(pageCount, num));
    if (!pages[num - 1]) return;
    pages[num - 1].div.scrollIntoView({ behavior: 'auto', block: 'start' });
    container.scrollTop = Math.max(0, container.scrollTop - 12);
  }

  function updatePageIndicator() {
    if (window.App) App.updatePage(getCurrentPage(), pageCount);
  }

  function onResize() {
    if (zoomMode !== 'free') {
      updateFitScale();
    }
  }

  // ---- Search ----
  function extractAllText(callback) {
    if (!pdfDoc) { callback(); return; }
    var done = 0;
    searchState.pageTexts = new Array(pageCount);
    for (var i = 0; i < pageCount; i++) {
      (function(idx) {
        pdfDoc.getPage(idx + 1).then(function(page) {
          return page.getTextContent();
        }).then(function(tc) {
          var text = '';
          for (var j = 0; j < tc.items.length; j++) {
            text += tc.items[j].str;
          }
          searchState.pageTexts[idx] = text;
          done++;
          if (done === pageCount) callback();
        }).catch(function() {
          searchState.pageTexts[idx] = '';
          done++;
          if (done === pageCount) callback();
        });
      })(i);
    }
  }

  function search(query) {
    clearSearchHighlights();
    searchState.query = query;
    searchState.flatMatches = [];
    searchState.current = -1;

    if (!query || !pdfDoc) {
      if (window.App) App.updateSearchCount(0, -1);
      return;
    }

    function doSearch() {
      var queryLower = query.toLowerCase();
      searchState.flatMatches = [];
      for (var i = 0; i < pageCount; i++) {
        var text = (searchState.pageTexts[i] || '').toLowerCase();
        var idx = 0;
        while ((idx = text.indexOf(queryLower, idx)) !== -1) {
          searchState.flatMatches.push({ page: i, offset: idx, length: queryLower.length });
          idx += 1;
        }
      }
      // Highlight on rendered pages
      for (var i = 0; i < pageCount; i++) {
        if (pages[i].rendered) highlightPageMatches(i);
      }
      if (searchState.flatMatches.length > 0) {
        searchState.current = 0;
        scrollToMatch(0);
      }
      if (window.App) App.updateSearchCount(searchState.flatMatches.length, searchState.current);
    }

    if (searchState.pageTexts.length === pageCount) {
      doSearch();
    } else {
      extractAllText(doSearch);
    }
  }

  function highlightPageMatches(pageIdx) {
    var p = pages[pageIdx];
    if (!p.textDivs.length) return;
    var query = searchState.query;
    if (!query) return;
    var queryLower = query.toLowerCase();

    // Remove old highlights
    var old = p.textLayer.querySelectorAll('.highlight');
    for (var i = 0; i < old.length; i++) old[i].remove();

    // Build text from text divs with positions
    var divTexts = [];
    for (var i = 0; i < p.textDivs.length; i++) {
      divTexts.push({ text: p.textDivs[i].textContent || '', div: p.textDivs[i] });
    }

    // For each textDiv, check if the query appears in it
    for (var i = 0; i < divTexts.length; i++) {
      var dt = divTexts[i];
      var textLower = dt.text.toLowerCase();
      var idx = 0;
      while ((idx = textLower.indexOf(queryLower, idx)) !== -1) {
        // Create a highlight overlay that covers this match
        var hlSpan = document.createElement('span');
        hlSpan.className = 'highlight';
        hlSpan.dataset.page = pageIdx;
        hlSpan.dataset.offset = idx;

        // Position based on the parent textDiv
        var divRect = dt.div.getBoundingClientRect();
        var layerRect = p.textLayer.getBoundingClientRect();
        var charW = divRect.width / (dt.text.length || 1);

        hlSpan.style.position = 'absolute';
        hlSpan.style.left = (divRect.left - layerRect.left + idx * charW) + 'px';
        hlSpan.style.top = (divRect.top - layerRect.top) + 'px';
        hlSpan.style.width = (queryLower.length * charW) + 'px';
        hlSpan.style.height = divRect.height + 'px';
        hlSpan.textContent = dt.text.substring(idx, idx + queryLower.length);

        p.textLayer.appendChild(hlSpan);
        idx += 1;
      }
    }
  }

  function clearSearchHighlights() {
    for (var i = 0; i < pages.length; i++) {
      var highlights = pages[i].textLayer.querySelectorAll('.highlight');
      for (var h = 0; h < highlights.length; h++) highlights[h].remove();
    }
  }

  function scrollToMatch(idx) {
    if (idx < 0 || idx >= searchState.flatMatches.length) return;
    searchState.current = idx;
    var match = searchState.flatMatches[idx];

    // Clear previous active
    var allActive = viewer.querySelectorAll('.highlight.active');
    for (var i = 0; i < allActive.length; i++) allActive[i].classList.remove('active');

    goToPage(match.page + 1);

    setTimeout(function() {
      // Find the highlight on this page that matches the offset
      var p = pages[match.page];
      if (!p.rendered) {
        if (window.App) App.updateSearchCount(searchState.flatMatches.length, searchState.current);
        return;
      }
      // Ensure highlights are rendered
      if (!p.textLayer.querySelector('.highlight')) highlightPageMatches(match.page);

      var highlights = p.textLayer.querySelectorAll('.highlight');
      // Find the right one by counting matches on this page
      var pageMatchIdx = 0;
      for (var i = 0; i < idx; i++) {
        if (searchState.flatMatches[i].page === match.page) pageMatchIdx++;
      }
      var target = null;
      var count = 0;
      for (var h = 0; h < highlights.length; h++) {
        if (count === pageMatchIdx) { target = highlights[h]; break; }
        count++;
      }
      if (target) {
        target.classList.add('active');
        target.scrollIntoView({ block: 'center' });
      }
      if (window.App) App.updateSearchCount(searchState.flatMatches.length, searchState.current);
    }, 300);
  }

  function searchNext() {
    if (!searchState.flatMatches.length) return;
    scrollToMatch((searchState.current + 1) % searchState.flatMatches.length);
  }

  function searchPrev() {
    if (!searchState.flatMatches.length) return;
    scrollToMatch((searchState.current - 1 + searchState.flatMatches.length) % searchState.flatMatches.length);
  }

  function clearSearch() {
    clearSearchHighlights();
    searchState = { flatMatches: [], current: -1, query: '', pageTexts: searchState.pageTexts || [] };
  }

  // ---- Outline / TOC ----
  function getOutline(callback) {
    if (!pdfDoc) { callback([]); return; }
    pdfDoc.getOutline().then(function(outline) {
      if (!outline) { callback([]); return; }
      var items = [];
      function flatten(list, level) {
        for (var i = 0; i < list.length; i++) {
          var item = list[i];
          items.push({ title: item.title, dest: item.dest, level: level });
          if (item.items && item.items.length > 0) {
            flatten(item.items, level + 1);
          }
        }
      }
      flatten(outline, 0);
      callback(items);
    }).catch(function() { callback([]); });
  }

  function navigateToDestination(dest) {
    if (!pdfDoc || !dest) return;
    if (typeof dest === 'string') {
      pdfDoc.getDestination(dest).then(function(resolved) {
        if (resolved && resolved.length > 0) {
          pdfDoc.getPageIndex(resolved[0]).then(function(pageIdx) {
            goToPage(pageIdx + 1);
          }).catch(function() {});
        }
      }).catch(function() {});
    } else if (Array.isArray(dest) && dest.length > 0) {
      pdfDoc.getPageIndex(dest[0]).then(function(pageIdx) {
        goToPage(pageIdx + 1);
      }).catch(function() {});
    }
  }

  return {
    init: init,
    loadPdf: loadPdf,
    cleanup: cleanup,
    setZoomMode: setZoomMode,
    zoomTo: zoomTo,
    zoomBy: zoomBy,
    getScale: getScale,
    getPageCount: getPageCount,
    getCurrentPage: getCurrentPage,
    goToPage: goToPage,
    updatePageIndicator: updatePageIndicator,
    onResize: onResize,
    search: search,
    searchNext: searchNext,
    searchPrev: searchPrev,
    clearSearch: clearSearch,
    getOutline: getOutline,
    navigateToDestination: navigateToDestination
  };
})();
