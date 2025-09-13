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

      // Handle range requests for video segments
      const range = req.headers.range;
      if (range && file.endsWith('.ts')) {
        const stat = await fileService.getFileStats(filePath);
        const fileSize = stat.size;
        
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        const stream = fileService.createReadStream(filePath, { start, end });
        
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp2t',
          'Cache-Control': 'public, max-age=31536000'
        });
        
        stream.pipe(res);
      } else {
        // Serve file normally
        if (file.endsWith('.m3u8')) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        } else if (file.endsWith('.ts')) {
          res.setHeader('Content-Type', 'video/mp2t');
        }
        
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.sendFile(filePath);
      }

    } catch (error) {
      console.error('Error serving HLS file:', error);
      res.status(500).json({ 
        error: 'Failed to serve HLS file' 
      });
    }
  }
}

module.exports = new StreamController();
