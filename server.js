const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const streamController = require('./controllers/streamController');
const cleanupService = require('./services/cleanupService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Enhanced request logging middleware for HTTP 206 debugging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n🌐 ${timestamp} - ${req.method} ${req.path}`);
  
  // Log Range header specifically
  if (req.headers.range) {
    console.log(`🎯 Range Header: ${req.headers.range}`);
  }
  
  // Log User-Agent for debugging different clients
  if (req.headers['user-agent']) {
    console.log(`🖥️  User-Agent: ${req.headers['user-agent'].substring(0, 50)}...`);
  }
  
  next();
});

app.use(morgan('combined'));
app.use(express.json());

// Serve static files (frontend)
app.use(express.static('public'));

// Routes
app.post('/stream', streamController.createStream);
app.get('/stream/:id', streamController.getStream);
app.get('/stream/:id/status', streamController.getStreamStatus);
app.get('/hls/:id/:file', streamController.getHLSFile);

// Network diagnostics endpoint for troubleshooting
app.post('/diagnostics', async (req, res) => {
  try {
    const { magnetUrl } = req.body;
    if (!magnetUrl) {
      return res.status(400).json({ error: 'Magnet URL required' });
    }
    
    console.log(`🔧 Running network diagnostics for magnet URL...`);
    
    // Import torrentService for diagnostics
    const torrentService = require('./services/torrentService');
    await torrentService.performNetworkDiagnostics(magnetUrl);
    
    res.json({ 
      status: 'completed', 
      message: 'Network diagnostics completed. Check server logs for details.' 
    });
  } catch (error) {
    console.error('Diagnostics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve frontend at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start cleanup service
cleanupService.startCleanupScheduler();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Torrent HLS Streamer running on port ${PORT}`);
  console.log(`📺 Stream endpoint: http://localhost:${PORT}/stream`);
});

module.exports = app;
