const express = require('express');
const torrentStream = require('torrent-stream');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('downloads'));

// Simple torrent downloader
class SimpleTorrentDownloader {
  constructor() {
    this.downloads = new Map(); // Track active downloads
    this.downloadDir = path.join(__dirname, 'downloads');
    
    // Ensure download directory exists
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  async startDownload(magnetUrl, downloadId = null) {
    const id = downloadId || this.generateId();
    
    console.log(`🚀 Starting download ${id}`);
    console.log(`🧲 Magnet: ${magnetUrl}`);
    
    const engine = torrentStream(magnetUrl, {
      path: this.downloadDir,
      connections: 100
    });

    const downloadInfo = {
      id,
      magnetUrl,
      status: 'starting',
      progress: 0,
      files: [],
      engine
    };

    this.downloads.set(id, downloadInfo);

    engine.on('ready', () => {
      console.log(`✅ Torrent ready: ${engine.torrent.name}`);
      console.log(`📁 Files: ${engine.files.length}`);
      
      downloadInfo.status = 'downloading';
      downloadInfo.files = engine.files.map(file => ({
        name: file.name,
        length: file.length,
        downloaded: 0
      }));

      // Select all files for download
      engine.files.forEach(file => {
        console.log(`📄 File: ${file.name} (${this.formatBytes(file.length)})`);
        file.select();
      });
    });

    engine.on('download', () => {
      const downloaded = engine.swarm?.downloaded || 0;
      const total = engine.torrent?.length || 1;
      const progress = Math.round((downloaded / total) * 100);
      
      downloadInfo.progress = progress;
      
      if (progress % 5 === 0) {
        console.log(`📥 Progress: ${progress}% (${this.formatBytes(downloaded)}/${this.formatBytes(total)})`);
      }
    });

    engine.on('idle', () => {
      console.log(`✅ Download complete: ${id}`);
      downloadInfo.status = 'completed';
    });

    engine.on('error', (error) => {
      console.error(`❌ Download error: ${error.message}`);
      downloadInfo.status = 'error';
      downloadInfo.error = error.message;
    });

    return id;
  }

  getDownloadStatus(id) {
    return this.downloads.get(id);
  }

  getAllDownloads() {
    return Array.from(this.downloads.values()).map(download => ({
      id: download.id,
      status: download.status,
      progress: download.progress,
      filesCount: download.files.length,
      error: download.error
    }));
  }

  generateId() {
    return Math.random().toString(36).substring(2, 15);
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

const downloader = new SimpleTorrentDownloader();

// Routes
app.post('/download', async (req, res) => {
  try {
    const { magnetUrl } = req.body;
    
    if (!magnetUrl) {
      return res.status(400).json({ error: 'Magnet URL is required' });
    }

    const downloadId = await downloader.startDownload(magnetUrl);
    
    res.json({
      downloadId,
      message: 'Download started',
      statusUrl: `/status/${downloadId}`
    });
  } catch (error) {
    console.error('Error starting download:', error);
    res.status(500).json({ error: 'Failed to start download' });
  }
});

app.get('/status/:id', (req, res) => {
  const { id } = req.params;
  const download = downloader.getDownloadStatus(id);
  
  if (!download) {
    return res.status(404).json({ error: 'Download not found' });
  }

  res.json({
    id: download.id,
    status: download.status,
    progress: download.progress,
    files: download.files,
    error: download.error
  });
});

app.get('/downloads', (req, res) => {
  res.json({
    downloads: downloader.getAllDownloads()
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Simple Torrent Downloader</title></head>
      <body>
        <h1>Simple Torrent Downloader</h1>
        <form id="downloadForm">
          <input type="text" id="magnetUrl" placeholder="Paste magnet URL here" style="width: 500px;">
          <button type="submit">Download</button>
        </form>
        <div id="status"></div>
        
        <script>
          document.getElementById('downloadForm').onsubmit = async (e) => {
            e.preventDefault();
            const magnetUrl = document.getElementById('magnetUrl').value;
            
            const response = await fetch('/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ magnetUrl })
            });
            
            const result = await response.json();
            
            if (response.ok) {
              document.getElementById('status').innerHTML = 
                '<p>Download started! ID: ' + result.downloadId + '</p>' +
                '<p><a href="' + result.statusUrl + '">Check Status</a></p>';
            } else {
              document.getElementById('status').innerHTML = '<p>Error: ' + result.error + '</p>';
            }
          };
        </script>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 Simple Torrent Server running on http://localhost:${PORT}`);
  console.log(`📝 Usage:`);
  console.log(`  - Open http://localhost:${PORT} in browser`);
  console.log(`  - Paste magnet URL and click Download`);
  console.log(`  - Files will be saved to ./downloads/ folder`);
});
