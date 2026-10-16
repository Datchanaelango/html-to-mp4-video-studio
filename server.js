const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const puppeteer = require('puppeteer-core');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure folders exist
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// Detect Chrome / Edge executable
function findBrowserExecutable() {
  const candidatePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    process.env.GOOGLE_CHROME_BIN,
    // Windows paths
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // Mac paths
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux paths
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];

  for (const p of candidatePaths) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }

  // Fallback to puppeteer default if any
  try {
    return puppeteer.executablePath();
  } catch (e) {
    return null;
  }
}

const BROWSER_PATH = findBrowserExecutable();
console.log('Detected Browser Executable:', BROWSER_PATH || 'NOT FOUND');
console.log('FFmpeg Executable:', ffmpeg.path);

// In-memory jobs tracking
const jobs = new Map();

// Helper to update job status
function updateJob(id, patch) {
  const job = jobs.get(id) || { jobId: id };
  jobs.set(id, { ...job, ...patch, jobId: id, updatedAt: Date.now() });
}

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileId = path.parse(req.file.filename).name;

    if (ext === '.zip') {
      // Extract ZIP
      const extractDir = path.join(UPLOADS_DIR, fileId);
      fs.mkdirSync(extractDir, { recursive: true });
      const zip = new AdmZip(req.file.path);
      zip.extractAllTo(extractDir, true);

      // Look for index.html or first html file
      const files = fs.readdirSync(extractDir);
      let entryHtml = files.find(f => f.toLowerCase() === 'index.html') ||
                      files.find(f => f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm'));

      if (!entryHtml) {
        return res.status(400).json({ error: 'No HTML file found inside the zip archive' });
      }

      return res.json({
        fileId,
        isZip: true,
        entryFile: entryHtml,
        previewUrl: `/api/preview/${fileId}/${entryHtml}`,
        filename: req.file.originalname
      });
    } else if (ext === '.html' || ext === '.htm') {
      return res.json({
        fileId,
        isZip: false,
        entryFile: req.file.filename,
        previewUrl: `/api/preview/${req.file.filename}`,
        filename: req.file.originalname
      });
    } else {
      return res.status(400).json({ error: 'Please upload a valid .html, .htm, or .zip file' });
    }
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload raw HTML snippet
app.post('/api/upload-snippet', (req, res) => {
  try {
    const { html } = req.body;
    if (!html || !html.trim()) {
      return res.status(400).json({ error: 'HTML content cannot be empty' });
    }
    const fileId = 'snippet-' + Date.now();
    const filename = `${fileId}.html`;
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, html, 'utf-8');

    res.json({
      fileId,
      isZip: false,
      entryFile: filename,
      previewUrl: `/api/preview/${filename}`,
      filename: 'Claude-Snippet.html'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve preview of uploaded HTML and sub-resources
app.use('/api/preview', express.static(UPLOADS_DIR));

// Render Video Endpoint
app.post('/api/render-video', async (req, res) => {
  const {
    fileId,
    entryFile,
    isZip,
    htmlCode,
    width = 1080,
    height = 1920,
    fps = 30,
    duration = 10,
    quality = 'high',
    delay = 1.0,
    addAudio = true
  } = req.body;

  if (!BROWSER_PATH) {
    return res.status(500).json({
      error: 'Google Chrome or Microsoft Edge was not found on this machine. Please ensure Chrome or Edge is installed.'
    });
  }

  const numWidth = Math.max(320, Math.min(3840, parseInt(width) || 1080));
  const numHeight = Math.max(320, Math.min(3840, parseInt(height) || 1920));
  // Ensure even dimensions for h264 encoder
  const finalWidth = numWidth % 2 === 0 ? numWidth : numWidth + 1;
  const finalHeight = numHeight % 2 === 0 ? numHeight : numHeight + 1;

  const numFps = Math.max(15, Math.min(60, parseInt(fps) || 30));
  const numDuration = Math.max(1, Math.min(300, parseFloat(duration) || 10));
  const numDelay = Math.max(0, Math.min(10, parseFloat(delay) || 1.0));

  const jobId = 'render-' + Date.now() + '-' + Math.round(Math.random() * 10000);
  const outputFilename = `video-${finalWidth}x${finalHeight}-${Date.now()}.mp4`;
  const outputPath = path.join(OUTPUTS_DIR, outputFilename);

  updateJob(jobId, {
    status: 'queued',
    progress: 5,
    message: 'Initializing video recording pipeline...',
    outputFilename,
    outputPath,
    width: finalWidth,
    height: finalHeight,
    duration: numDuration,
    fps: numFps
  });

  // Respond immediately with jobId for asynchronous polling
  res.json({
    jobId,
    status: 'queued',
    message: 'Rendering task initiated'
  });

  // Start background recording
  runRecordingPipeline({
    jobId,
    fileId,
    entryFile,
    isZip,
    htmlCode,
    width: finalWidth,
    height: finalHeight,
    fps: numFps,
    duration: numDuration,
    quality,
    delay: numDelay,
    addAudio,
    outputPath
  }).catch(err => {
    console.error(`Job ${jobId} failed:`, err);
    updateJob(jobId, {
      status: 'error',
      error: err.message || 'Video recording failed'
    });
  });
});

// Core Puppeteer + FFmpeg recording worker
async function runRecordingPipeline(params) {
  const {
    jobId,
    fileId,
    entryFile,
    isZip,
    htmlCode,
    width,
    height,
    fps,
    duration,
    quality,
    delay,
    addAudio,
    outputPath
  } = params;

  let targetUrl;
  let tempHtmlPath = null;

  if (htmlCode) {
    tempHtmlPath = path.join(UPLOADS_DIR, `temp-${jobId}.html`);
    const codeStr = typeof htmlCode === 'string' ? htmlCode : (htmlCode ? String(htmlCode) : '');
    fs.writeFileSync(tempHtmlPath, codeStr, 'utf-8');
    targetUrl = `http://localhost:${PORT}/api/preview/${path.basename(tempHtmlPath)}`;
  } else if (isZip && fileId && entryFile) {
    targetUrl = `http://localhost:${PORT}/api/preview/${fileId}/${entryFile}`;
  } else if (fileId && entryFile) {
    targetUrl = `http://localhost:${PORT}/api/preview/${entryFile}`;
  } else {
    throw new Error('No valid HTML source provided');
  }

  updateJob(jobId, {
    status: 'starting_browser',
    progress: 15,
    message: `Launching Chrome browser (${width}x${height})...`
  });

  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      `--window-size=${width},${height}`,
      '--hide-scrollbars',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: 1
    });

    updateJob(jobId, {
      status: 'loading_page',
      progress: 25,
      message: 'Loading HTML animation...'
    });

    await page.goto(targetUrl, {
      waitUntil: ['load', 'networkidle2'],
      timeout: 30000
    });

    // Inject CSS to guarantee full-frame fitting and eliminate any scrollbars
    await page.addStyleTag({
      content: `
        ::-webkit-scrollbar { display: none !important; }
        body { margin: 0; padding: 0; overflow: hidden !important; }
      `
    });

    // Ensure continuous repaints so Chrome CDP screencast captures at full steady FPS
    await page.evaluate(() => {
      const dummy = document.createElement('div');
      dummy.style.position = 'fixed';
      dummy.style.bottom = '0';
      dummy.style.right = '0';
      dummy.style.width = '1px';
      dummy.style.height = '1px';
      dummy.style.pointerEvents = 'none';
      dummy.style.opacity = '0.01';
      dummy.style.zIndex = '999999';
      document.body.appendChild(dummy);

      let toggle = false;
      function tick() {
        toggle = !toggle;
        dummy.style.transform = toggle ? 'translateZ(0.1px)' : 'translateZ(0px)';
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });

    if (delay > 0) {
      updateJob(jobId, {
        status: 'waiting_delay',
        progress: 30,
        message: `Waiting ${delay}s for animations/canvas to initialize...`
      });
      await new Promise(r => setTimeout(r, delay * 1000));
    }

    // Determine CRF based on quality
    let crf = '20';
    let preset = 'fast';
    if (quality === 'ultra') {
      crf = '16';
      preset = 'medium';
    } else if (quality === 'medium') {
      crf = '24';
      preset = 'veryfast';
    }

    // Build FFmpeg command arguments
    // Uses image2pipe with mjpeg input
    const ffmpegArgs = [
      '-y',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-framerate', String(fps),
      '-i', '-'
    ];

    if (addAudio) {
      // Add silent AAC audio track with matching duration
      ffmpegArgs.push(
        '-f', 'lavfi',
        '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`
      );
    }

    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', preset,
      '-crf', crf,
      '-movflags', '+faststart'
    );

    if (addAudio) {
      ffmpegArgs.push(
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest'
      );
    }

    ffmpegArgs.push(outputPath);

    console.log(`Starting FFmpeg for Job ${jobId}...`);
    const ffmpegProc = spawn(ffmpeg.path, ffmpegArgs);

    let ffmpegErr = '';
    ffmpegProc.stderr.on('data', chunk => {
      ffmpegErr += chunk.toString();
    });

    const client = await page.target().createCDPSession();
    let frameCount = 0;
    const totalExpectedFrames = Math.round(duration * fps);

    client.on('Page.screencastFrame', async ({ data, sessionId }) => {
      try {
        if (!ffmpegProc.stdin.destroyed) {
          ffmpegProc.stdin.write(Buffer.from(data, 'base64'));
          frameCount++;
        }
        await client.send('Page.screencastFrameAck', { sessionId });
      } catch (e) {
        // stream ended or client closed
      }
    });

    updateJob(jobId, {
      status: 'recording',
      progress: 35,
      message: `Recording frames (${duration}s at ${fps} FPS)...`
    });

    // Start screencast
    await client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 95,
      maxWidth: width,
      maxHeight: height,
      everyNthFrame: 1
    });

    // Track recording progress interval
    const startTime = Date.now();
    const durationMs = duration * 1000;
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const recPercent = Math.min(1, elapsed / durationMs);
      // Map 35% -> 85% during recording
      const overallProgress = Math.round(35 + recPercent * 50);
      updateJob(jobId, {
        progress: overallProgress,
        message: `Recording: ${(recPercent * duration).toFixed(1)}s / ${duration}s (${frameCount} frames captured)...`
      });
    }, 400);

    // Wait for the full duration
    await new Promise(r => setTimeout(r, durationMs));
    clearInterval(progressInterval);

    updateJob(jobId, {
      status: 'encoding',
      progress: 88,
      message: 'Finalizing MP4 encoding and optimizing metadata...'
    });

    try {
      await client.send('Page.stopScreencast');
    } catch (e) {}

    await browser.close();

    // Close ffmpeg stdin and wait for completion
    ffmpegProc.stdin.end();

    await new Promise((resolve, reject) => {
      ffmpegProc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}. Error: ${ffmpegErr.slice(-300)}`));
      });
      ffmpegProc.on('error', reject);
    });

    const stats = fs.statSync(outputPath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    updateJob(jobId, {
      status: 'ready',
      progress: 100,
      message: 'Video rendering complete!',
      downloadUrl: `/api/download/${jobId}`,
      fileSizeMB: sizeInMB,
      fileSizeBytes: stats.size,
      frameCount,
      duration,
      resolution: `${width}x${height}`
    });

    console.log(`Job ${jobId} finished successfully! File: ${sizeInMB} MB`);
  } catch (err) {
    try { await browser.close(); } catch (e) {}
    throw err;
  } finally {
    if (tempHtmlPath && fs.existsSync(tempHtmlPath)) {
      try { fs.unlinkSync(tempHtmlPath); } catch (e) {}
    }
  }
}

// Progress check endpoint
app.get('/api/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Download video endpoint
app.get('/api/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).send('Video file not found or still processing');
  }

  const customFilename = `html-video-${job.resolution || 'custom'}-${Date.now()}.mp4`;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${customFilename}"`);
  res.sendFile(job.outputPath);
});

// Stream video for preview in UI
app.get('/api/video-stream/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).send('Video not found');
  }
  res.sendFile(job.outputPath);
});

// Health / status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    browserPath: BROWSER_PATH,
    browserAvailable: !!BROWSER_PATH,
    ffmpegPath: ffmpeg.path,
    activeJobs: jobs.size
  });
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 HTML to MP4 Video Converter running at:`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
