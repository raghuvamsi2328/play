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
app.use(morgan('combined'));
app.use(express.json());

// Serve static files (frontend)
app.use(express.static('public'));

// Routes
app.post('/stream', streamController.createStream);
app.get('/stream/:id', streamController.getStream);
app.get('/stream/:id/status', streamController.getStreamStatus);
app.get('/hls/:id/:file', streamController.getHLSFile);

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
