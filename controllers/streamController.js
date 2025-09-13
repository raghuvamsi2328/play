const { v4: uuidv4 } = require('uuid');
const torrentService = require('../services/torrentService');
const ffmpegService = require('../services/ffmpegService');
const fileService = require('../services/fileService');
const streamManager = require('../services/streamManager');

class StreamController {
  async createStream(req, res) {
    try {
      const { magnetUrl } = req.body;
      
      if (!magnetUrl) {
        return res.status(400).json({ 
          error: 'Magnet URL is required' 
        });
      }

      const streamId = uuidv4();
      
      // Initialize stream
      const stream = streamManager.createStream(streamId, magnetUrl);
      
      // Start torrent download
      torrentService.startDownload(streamId, magnetUrl)
        .then(() => {
          console.log(`✅ Download started for stream ${streamId}`);
        })
        .catch((error) => {
          console.error(`❌ Download failed for stream ${streamId}:`, error);
          streamManager.updateStreamStatus(streamId, 'error', error.message);
        });

      res.json({
        streamId,
        status: 'initializing',
        hlsUrl: `/stream/${streamId}`,
        statusUrl: `/stream/${streamId}/status`
      });

    } catch (error) {
      console.error('Error creating stream:', error);
      res.status(500).json({ 
        error: 'Failed to create stream' 
      });
    }
  }

  async getStream(req, res) {
    try {
      const { id } = req.params;
      const stream = streamManager.getStream(id);

      if (!stream) {
        return res.status(404).json({ 
          error: 'Stream not found' 
        });
      }

      if (stream.status !== 'ready') {
        return res.status(202).json({
          status: stream.status,
          message: 'Stream is not ready yet',
          progress: stream.progress || 0
        });
      }

      // Serve HLS playlist
      const playlistPath = fileService.getHLSPlaylistPath(id);
      
      if (!fileService.fileExists(playlistPath)) {
        return res.status(404).json({ 
          error: 'HLS playlist not found' 
        });
      }

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(playlistPath);

    } catch (error) {
      console.error('Error getting stream:', error);
      res.status(500).json({ 
        error: 'Failed to get stream' 
      });
    }
  }

  async getStreamStatus(req, res) {
    try {
      const { id } = req.params;
      const stream = streamManager.getStream(id);

      if (!stream) {
        return res.status(404).json({ 
          error: 'Stream not found' 
        });
      }

      res.json({
        streamId: id,
        status: stream.status,
        progress: stream.progress || 0,
        error: stream.error || null,
        createdAt: stream.createdAt,
        updatedAt: stream.updatedAt
      });

    } catch (error) {
      console.error('Error getting stream status:', error);
      res.status(500).json({ 
        error: 'Failed to get stream status' 
      });
    }
  }

  async getHLSFile(req, res) {
    try {
      const { id, file } = req.params;
      const stream = streamManager.getStream(id);

      if (!stream) {
        return res.status(404).json({ 
          error: 'Stream not found' 
        });
      }

      const filePath = fileService.getHLSFilePath(id, file);
      
      if (!fileService.fileExists(filePath)) {
        return res.status(404).json({ 
          error: 'HLS file not found' 
        });
      }

          // Handle range requests for .ts files (HTTP 206 partial content)
    const range = req.headers.range;
    
    // Enhanced logging for HTTP 206 debugging
    console.log(`🔍 Range header: ${range ? range : 'None'}, File: ${file}`);
    console.log(`📊 User-Agent: ${req.headers['user-agent'] || 'Unknown'}`);
    
    if (range && file.endsWith('.ts')) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;

        console.log(`🎯 HTTP 206 PARTIAL CONTENT: ${file}`);
        console.log(`📊 Range: ${start}-${end}/${fileSize} (${chunkSize} bytes)`);

        res.status(206);
        res.set({
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': contentType
        });

        const stream = fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
        return;
    }

    // Serve complete file (HTTP 200)
    console.log(`📄 HTTP 200 COMPLETE FILE: ${file} (${fileSize} bytes)`);
    res.set({
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType
    });
    
    fs.createReadStream(filePath).pipe(res);

    } catch (error) {
      console.error('Error serving HLS file:', error);
      res.status(500).json({ 
        error: 'Failed to serve HLS file' 
      });
    }
  }
}

module.exports = new StreamController();
