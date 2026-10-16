// State
let currentSource = {
  type: null, // 'upload' | 'snippet' | 'sample'
  fileId: null,
  entryFile: null,
  isZip: false,
  previewUrl: null,
  htmlCode: null
};

let currentDimensions = {
  preset: 'horizontal',
  width: 1920,
  height: 1080
};

let currentSettings = {
  fps: 30,
  duration: 10,
  quality: 'high',
  delay: 1.0,
  addAudio: true
};

let isRendering = false;
let pollingInterval = null;

// DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const clearFileBtn = document.getElementById('clearFileBtn');

const htmlSnippetInput = document.getElementById('htmlSnippetInput');
const applySnippetBtn = document.getElementById('applySnippetBtn');

const previewIframe = document.getElementById('previewIframe');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const reloadPreviewBtn = document.getElementById('reloadPreviewBtn');
const viewportFrame = document.getElementById('viewportFrame');
const viewportCanvas = document.getElementById('viewportCanvas');
const dimensionPill = document.getElementById('dimensionPill');

const orientBtns = document.querySelectorAll('.orient-btn');
const resolutionSelectorGroup = document.getElementById('resolutionSelectorGroup');
const resPresetSelect = document.getElementById('resPresetSelect');
const customDimensionsGroup = document.getElementById('customDimensionsGroup');
const customWidth = document.getElementById('customWidth');
const customHeight = document.getElementById('customHeight');
const swapDimensionsBtn = document.getElementById('swapDimensionsBtn');

const fpsBtns = document.querySelectorAll('#fpsGroup .pill-btn');
const durationBtns = document.querySelectorAll('#durationGroup .pill-btn');
const customDuration = document.getElementById('customDuration');
const qualitySelect = document.getElementById('qualitySelect');
const delaySelect = document.getElementById('delaySelect');
const addAudioCheck = document.getElementById('addAudioCheck');

const renderBtn = document.getElementById('renderBtn');
const progressCard = document.getElementById('progressCard');
const progressStatusText = document.getElementById('progressStatusText');
const progressDetailText = document.getElementById('progressDetailText');
const progressPercentage = document.getElementById('progressPercentage');
const progressBarFill = document.getElementById('progressBarFill');

const videoReadyCard = document.getElementById('videoReadyCard');
const videoMetaText = document.getElementById('videoMetaText');
const downloadVideoBtn = document.getElementById('downloadVideoBtn');
const outputVideoPlayer = document.getElementById('outputVideoPlayer');

// Resolution Presets Dictionary
const RESOLUTIONS = {
  horizontal: [
    { label: '1920 × 1080 (1080p Full HD Horizontal)', w: 1920, h: 1080 },
    { label: '1280 × 720 (720p HD Horizontal)', w: 1280, h: 720 },
    { label: '3840 × 2160 (4K Ultra HD Horizontal)', w: 3840, h: 2160 }
  ],
  vertical: [
    { label: '1080 × 1920 (Reels / Shorts / TikTok 1080p)', w: 1080, h: 1920 },
    { label: '720 × 1280 (HD Vertical)', w: 720, h: 1280 },
    { label: '1440 × 2560 (2K QHD Vertical)', w: 1440, h: 2560 }
  ],
  square: [
    { label: '1080 × 1080 (Instagram Feed / Square 1:1)', w: 1080, h: 1080 },
    { label: '720 × 720 (Medium Square)', w: 720, h: 720 }
  ]
};

// Initialize
function init() {
  setupTabs();
  setupDropzone();
  setupSamples();
  setupOrientations();
  setupQualitySettings();
  setupRenderHandler();

  // Load default sample so user sees an active preview immediately!
  loadSample('particles');
  updateViewportScale();
  window.addEventListener('resize', updateViewportScale);
}

// Tabs
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
}

// File Upload & Drag-and-Drop
function setupDropzone() {
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  ['dragleave', 'dragend'].forEach(type => {
    dropzone.addEventListener(type, () => dropzone.classList.remove('dragover'));
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFileUpload(fileInput.files[0]);
    }
  });

  clearFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetSource();
  });

  applySnippetBtn.addEventListener('click', () => {
    const code = htmlSnippetInput.value.trim();
    if (!code) {
      alert('Please paste some HTML code first');
      return;
    }
    handleSnippetUpload(code);
  });
}

async function handleFileUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  try {
    dropzone.classList.add('hidden');
    fileInfo.classList.remove('hidden');
    fileName.textContent = 'Uploading: ' + file.name + '...';

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    currentSource = {
      type: 'upload',
      fileId: data.fileId,
      entryFile: data.entryFile,
      isZip: data.isZip,
      previewUrl: data.previewUrl,
      htmlCode: null
    };

    fileName.textContent = file.name;
    loadPreview(data.previewUrl);
  } catch (err) {
    alert('Upload error: ' + err.message);
    resetSource();
  }
}

async function handleSnippetUpload(html) {
  try {
    applySnippetBtn.textContent = 'Loading snippet...';
    applySnippetBtn.disabled = true;

    const res = await fetch('/api/upload-snippet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Snippet upload failed');

    currentSource = {
      type: 'snippet',
      fileId: data.fileId,
      entryFile: data.entryFile,
      isZip: false,
      previewUrl: data.previewUrl,
      htmlCode: html
    };

    loadPreview(data.previewUrl);
  } catch (err) {
    alert('Error loading code: ' + err.message);
  } finally {
    applySnippetBtn.textContent = 'Load Code into Preview';
    applySnippetBtn.disabled = false;
  }
}

// Samples
function setupSamples() {
  document.querySelectorAll('.sample-card').forEach(btn => {
    btn.addEventListener('click', () => {
      loadSample(btn.dataset.sample);
    });
  });
}

function loadSample(sampleName) {
  const url = `/samples/${sampleName}.html`;
  currentSource = {
    type: 'sample',
    fileId: null,
    entryFile: null,
    isZip: false,
    previewUrl: url,
    htmlCode: null,
    sampleName
  };

  // If cyberpunk is chosen, recommend vertical preset automatically
  if (sampleName === 'cyberpunk') {
    selectOrientation('vertical');
  } else if (sampleName === 'particles') {
    selectOrientation('horizontal');
  }

  loadPreview(url);
}

function resetSource() {
  currentSource = {
    type: null,
    fileId: null,
    entryFile: null,
    isZip: false,
    previewUrl: null,
    htmlCode: null
  };
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropzone.classList.remove('hidden');
  previewIframe.classList.add('hidden');
  previewPlaceholder.classList.remove('hidden');
  previewIframe.src = 'about:blank';
}

function loadPreview(url) {
  previewPlaceholder.classList.add('hidden');
  previewIframe.classList.remove('hidden');
  previewIframe.src = url;
}

reloadPreviewBtn.addEventListener('click', () => {
  if (previewIframe.src && previewIframe.src !== 'about:blank') {
    previewIframe.src = previewIframe.src;
  }
});

// Orientation & Custom Dimensions
function setupOrientations() {
  orientBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      selectOrientation(btn.dataset.preset);
    });
  });

  resPresetSelect.addEventListener('change', () => {
    const [w, h] = resPresetSelect.value.split('x').map(Number);
    currentDimensions.width = w;
    currentDimensions.height = h;
    updateDimensionsUI();
  });

  customWidth.addEventListener('input', () => {
    currentDimensions.width = parseInt(customWidth.value) || 1920;
    updateDimensionsUI();
  });

  customHeight.addEventListener('input', () => {
    currentDimensions.height = parseInt(customHeight.value) || 1080;
    updateDimensionsUI();
  });

  swapDimensionsBtn.addEventListener('click', () => {
    const temp = currentDimensions.width;
    currentDimensions.width = currentDimensions.height;
    currentDimensions.height = temp;
    customWidth.value = currentDimensions.width;
    customHeight.value = currentDimensions.height;
    updateDimensionsUI();
  });
}

function selectOrientation(preset) {
  orientBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
  currentDimensions.preset = preset;

  if (preset === 'custom') {
    resolutionSelectorGroup.classList.add('hidden');
    customDimensionsGroup.classList.remove('hidden');
    currentDimensions.width = parseInt(customWidth.value) || 1920;
    currentDimensions.height = parseInt(customHeight.value) || 1080;
  } else {
    resolutionSelectorGroup.classList.remove('hidden');
    customDimensionsGroup.classList.add('hidden');

    const options = RESOLUTIONS[preset] || [];
    resPresetSelect.innerHTML = options
      .map(o => `<option value="${o.w}x${o.h}">${o.label}</option>`)
      .join('');

    if (options.length > 0) {
      currentDimensions.width = options[0].w;
      currentDimensions.height = options[0].h;
    }
  }

  updateDimensionsUI();
}

function updateDimensionsUI() {
  const { width, height } = currentDimensions;
  dimensionPill.textContent = `${width} × ${height} (${getAspectRatioLabel(width, height)})`;
  updateViewportScale();
}

function getAspectRatioLabel(w, h) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(w, h);
  const rW = w / divisor;
  const rH = h / divisor;
  if ((rW === 16 && rH === 9) || (rW === 9 && rH === 16) || (rW === 1 && rH === 1)) {
    return `${rW}:${rH}`;
  }
  return `${(w / h).toFixed(2)}:1`;
}

// Adjust viewport frame aspect ratio in the UI
function updateViewportScale() {
  const canvasW = viewportCanvas.clientWidth - 40;
  const canvasH = viewportCanvas.clientHeight - 40;
  const targetAspect = currentDimensions.width / currentDimensions.height;

  let frameW, frameH;
  if (canvasW / canvasH > targetAspect) {
    frameH = Math.min(canvasH, 500);
    frameW = frameH * targetAspect;
  } else {
    frameW = Math.min(canvasW, 700);
    frameH = frameW / targetAspect;
  }

  viewportFrame.style.width = `${Math.round(frameW)}px`;
  viewportFrame.style.height = `${Math.round(frameH)}px`;
}

// Quality & Settings
function setupQualitySettings() {
  fpsBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      fpsBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSettings.fps = parseInt(btn.dataset.fps);
    });
  });

  durationBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      durationBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const dur = parseInt(btn.dataset.dur);
      currentSettings.duration = dur;
      customDuration.value = dur;
    });
  });

  customDuration.addEventListener('input', () => {
    const val = Math.max(1, Math.min(180, parseInt(customDuration.value) || 10));
    currentSettings.duration = val;
    durationBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.dur) === val));
  });

  qualitySelect.addEventListener('change', () => {
    currentSettings.quality = qualitySelect.value;
  });

  delaySelect.addEventListener('change', () => {
    currentSettings.delay = parseFloat(delaySelect.value);
  });

  addAudioCheck.addEventListener('change', () => {
    currentSettings.addAudio = addAudioCheck.checked;
  });
}

// Render Video Pipeline Trigger
function setupRenderHandler() {
  renderBtn.addEventListener('click', async () => {
    if (isRendering) return;

    if (!currentSource.previewUrl && !currentSource.htmlCode && !currentSource.sampleName) {
      alert('Please upload an HTML file, paste code, or select a demo sample first!');
      return;
    }

    try {
      isRendering = true;
      renderBtn.disabled = true;
      renderBtn.innerHTML = `
        <span class="spinner" style="width:18px;height:18px;border-width:2px;"></span>
        <span>Rendering in progress...</span>
      `;

      videoReadyCard.classList.add('hidden');
      progressCard.classList.remove('hidden');
      updateProgress(10, 'Initializing video engine...');

      // Prepare payload
      const payload = {
        width: currentDimensions.width,
        height: currentDimensions.height,
        fps: currentSettings.fps,
        duration: currentSettings.duration,
        quality: currentSettings.quality,
        delay: currentSettings.delay,
        addAudio: currentSettings.addAudio
      };

      if (currentSource.type === 'sample') {
        // Fetch sample content directly to pass to render
        const sampleRes = await fetch(currentSource.previewUrl);
        payload.htmlCode = await sampleRes.text();
      } else if (currentSource.type === 'snippet') {
        payload.htmlCode = currentSource.htmlCode;
      } else if (currentSource.type === 'upload') {
        payload.fileId = currentSource.fileId;
        payload.entryFile = currentSource.entryFile;
        payload.isZip = currentSource.isZip;
      }

      const res = await fetch('/api/render-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start video render');

      // Poll progress
      pollJobProgress(data.jobId);

    } catch (err) {
      alert('Error: ' + err.message);
      finishRendering(false);
    }
  });
}

function pollJobProgress(jobId) {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/progress/${jobId}`);
      if (!res.ok) return;

      const job = await res.json();
      updateProgress(job.progress || 20, job.message || 'Processing...');

      if (job.status === 'ready') {
        clearInterval(pollingInterval);
        handleVideoReady(job);
      } else if (job.status === 'error') {
        clearInterval(pollingInterval);
        alert('Render failed: ' + (job.error || 'Unknown error'));
        finishRendering(false);
      }
    } catch (e) {
      console.warn('Poll error:', e);
    }
  }, 500);
}

function updateProgress(percent, message) {
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  progressBarFill.style.width = pct + '%';
  progressPercentage.textContent = pct + '%';
  progressDetailText.textContent = message;
}

function handleVideoReady(job) {
  updateProgress(100, 'Complete!');
  setTimeout(() => {
    progressCard.classList.add('hidden');
    videoReadyCard.classList.remove('hidden');

    videoMetaText.textContent = `MP4 • ${job.resolution} • ${job.duration}s • ${job.fps} FPS • ${job.fileSizeMB} MB`;
    downloadVideoBtn.href = job.downloadUrl;
    outputVideoPlayer.src = `/api/video-stream/${job.jobId}`;
    outputVideoPlayer.play().catch(() => {});

    finishRendering(true);
  }, 600);
}

function pathBase(url) {
  return url ? url.split('/').pop() : '';
}

function finishRendering(success) {
  isRendering = false;
  renderBtn.disabled = false;
  renderBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="12" cy="12" r="10"></circle>
      <polygon points="10 8 16 12 10 16 10 8"></polygon>
    </svg>
    <span>Render & Download MP4 Video</span>
  `;
}

// Start app
window.addEventListener('DOMContentLoaded', init);
