const torrentStream = require('torrent-stream');
const path = require('path');
const ffmpegService = require('./ffmpegService');
const fileService = require('./fileService');
const streamManager = require('./streamManager');

class TorrentService {
  constructor() {
    this.activeEngines = new Map();
  }

  async startDownload(streamId, magnetUrl) {
    try {
      console.log(`🌊 Starting torrent download for stream ${streamId}`);
      
      const engine = torrentStream(magnetUrl, {
        tmp: fileService.getTempDir(),
        path: fileService.getStreamDir(streamId),
        connections: 100,     // Allow more connections
        uploads: 10,          // Allow more uploads to get better reciprocation
        verify: true,         // Verify pieces
        dht: true,            // Enable DHT
        tracker: true,        // Enable trackers
        trackers: [           // Add additional trackers
          'udp://tracker.openbittorrent.com:80',
          'udp://tracker.opentrackr.org:1337/announce',
          'udp://tracker.coppersurfer.tk:6969/announce',
          'udp://exodus.desync.com:6969/announce',
          'udp://tracker.torrent.eu.org:451/announce'
        ]
      });

      this.activeEngines.set(streamId, engine);

      engine.on('ready', () => {
        console.log(`📦 Torrent ready for stream ${streamId}`);
        console.log(`📁 Torrent contains ${engine.files.length} files`);
        console.log(`💾 Total torrent size: ${this.formatFileSize(engine.torrent.length)}`);
        console.log(`🔗 Torrent info hash: ${engine.torrent.infoHash}`);
        console.log(`👥 Initial peers: ${engine.swarm.wires.length}`);
        
        // Log torrent structure for debugging
        this.logTorrentStructure(engine.files);
        
        // Find the largest video file
        const videoFile = this.findLargestVideoFile(engine.files);
        
        if (!videoFile) {
          const errorMsg = 'No suitable video file found in torrent. Check that torrent contains video files larger than 50MB.';
          console.error(`❌ ${errorMsg}`);
          streamManager.updateStreamStatus(streamId, 'error', errorMsg);
          this.cleanup(streamId);
          return;
        }

        console.log(`🎬 Selected video file: ${videoFile.name} (${this.formatFileSize(videoFile.length)})`);
        
        // Log the full path structure
        const pathParts = videoFile.name.split('/');
        if (pathParts.length > 1) {
          console.log(`📁 Video is in folder: ${pathParts.slice(0, -1).join('/')}`);
        }
        streamManager.updateStreamStatus(streamId, 'downloading');

        // Select the file for download
        videoFile.select();
        console.log(`✅ Video file selected for download`);

        // Start periodic progress checking
        this.startProgressMonitoring(streamId, engine);
        
        // Start swarm monitoring
        this.startSwarmMonitoring(streamId, engine);

        // Start FFmpeg conversion when file starts downloading
        this.startFFmpegConversion(streamId, videoFile, engine);
      });

      engine.on('download', (index) => {
        // More robust progress calculation
        const downloaded = engine.swarm?.downloaded || 0;
        const total = engine.torrent?.length || 1;
        const progress = Math.round((downloaded / total) * 100);
        
        console.log(`📥 Downloaded: ${this.formatFileSize(downloaded)} / ${this.formatFileSize(total)} (${progress}%)`);
        streamManager.updateStreamProgress(streamId, progress);
      });

      engine.on('error', (error) => {
        console.error(`❌ Torrent error for stream ${streamId}:`, error);
        streamManager.updateStreamStatus(streamId, 'error', error.message);
        this.cleanup(streamId);
      });

      // Add more detailed event logging
      engine.on('peer', (peer) => {
        console.log(`👋 New peer connected for stream ${streamId}: ${peer.remoteAddress}`);
      });

      engine.on('noPeers', () => {
        console.log(`😞 No peers found for stream ${streamId} - torrent might be dead`);
      });

      // Monitor when pieces are downloaded
      engine.on('hotswap', () => {
        console.log(`🔥 Hotswap event for stream ${streamId}`);
      });

      // Log when torrent is fully downloaded
      engine.on('idle', () => {
        console.log(`💤 Torrent idle for stream ${streamId} - download complete`);
      });

    } catch (error) {
      console.error(`❌ Failed to start download for stream ${streamId}:`, error);
      streamManager.updateStreamStatus(streamId, 'error', error.message);
      throw error;
    }
  }

  findLargestVideoFile(files) {
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts', '.m2ts'];
    const excludePatterns = ['sample', 'trailer', 'preview', 'extra', 'bonus', 'behind', 'making'];
    
    console.log(`📁 Analyzing ${files.length} files in torrent`);
    
    const videoFiles = files
      .filter(file => {
        const ext = path.extname(file.name).toLowerCase();
        const fileName = path.basename(file.name).toLowerCase();
        
        // Check if it's a video file
        const isVideo = videoExtensions.includes(ext);
        
        // Skip sample/trailer files (usually smaller promotional videos)
        const isSample = excludePatterns.some(pattern => fileName.includes(pattern));
        
        // Skip very small files (likely not main content)
        const isLargeEnough = file.length > 50 * 1024 * 1024; // 50MB minimum
        
        if (isVideo) {
          console.log(`🎬 Found video file: ${file.name} (${this.formatFileSize(file.length)}) - ${isSample ? 'SAMPLE/TRAILER' : 'VALID'} - ${isLargeEnough ? 'LARGE ENOUGH' : 'TOO SMALL'}`);
        }
        
        return isVideo && !isSample && isLargeEnough;
      })
      .sort((a, b) => b.length - a.length); // Sort by size, largest first
    
    if (videoFiles.length === 0) {
      console.log('❌ No valid video files found');
      console.log('📋 All files in torrent:');
      files.forEach(file => {
        const ext = path.extname(file.name).toLowerCase();
        console.log(`   - ${file.name} (${this.formatFileSize(file.length)}) [${ext || 'no extension'}]`);
      });
      return null;
    }
    
    console.log(`✅ Selected largest valid video: ${videoFiles[0].name} (${this.formatFileSize(videoFiles[0].length)})`);
    
    // Log other video files found for reference
    if (videoFiles.length > 1) {
      console.log(`📋 Other video files found (${videoFiles.length - 1}):`);
      videoFiles.slice(1, 5).forEach(file => { // Show up to 4 additional files
        console.log(`   - ${file.name} (${this.formatFileSize(file.length)})`);
      });
    }
    
    return videoFiles[0];
  }

  formatFileSize(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  logTorrentStructure(files) {
    const folderStructure = {};
    
    files.forEach(file => {
      const pathParts = file.name.split('/');
      if (pathParts.length > 1) {
        const folder = pathParts[0];
        if (!folderStructure[folder]) {
          folderStructure[folder] = [];
        }
        folderStructure[folder].push({
          name: pathParts.slice(1).join('/'),
          size: file.length,
          ext: path.extname(file.name).toLowerCase()
        });
      } else {
        if (!folderStructure['root']) {
          folderStructure['root'] = [];
        }
        folderStructure['root'].push({
          name: file.name,
          size: file.length,
          ext: path.extname(file.name).toLowerCase()
        });
      }
    });

    console.log('📂 Torrent structure:');
    Object.entries(folderStructure).forEach(([folder, files]) => {
      console.log(`  📁 ${folder}/`);
      const videoFiles = files.filter(f => ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts', '.m2ts'].includes(f.ext));
      const otherFiles = files.filter(f => !['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts', '.m2ts'].includes(f.ext));
      
      // Show video files first
      videoFiles.slice(0, 3).forEach(file => {
        console.log(`    🎬 ${file.name} (${this.formatFileSize(file.size)})`);
      });
      
      // Show a few other files
      otherFiles.slice(0, 2).forEach(file => {
        console.log(`    📄 ${file.name} (${this.formatFileSize(file.size)})`);
      });
      
      if (files.length > 5) {
        console.log(`    ... and ${files.length - 5} more files`);
      }
    });
  }

  startSwarmMonitoring(streamId, engine) {
    const monitorSwarm = () => {
      if (!this.activeEngines.has(streamId)) {
        return;
      }

      try {
        const swarm = engine.swarm;
        const peers = swarm.wires.length;
        const activePeers = swarm.wires.filter(wire => !wire.peerChoking).length;
        const downloadSpeed = Math.round(swarm.downloadSpeed() / 1024); // KB/s
        const uploadSpeed = Math.round(swarm.uploadSpeed() / 1024); // KB/s
        
        console.log(`🕸️ Swarm status - Stream ${streamId}:`);
        console.log(`  👥 Peers: ${peers} (${activePeers} active)`);
        console.log(`  ⬇️ Download: ${downloadSpeed} KB/s`);
        console.log(`  ⬆️ Upload: ${uploadSpeed} KB/s`);
        console.log(`  📊 Downloaded: ${this.formatFileSize(swarm.downloaded)}`);
        
        if (peers === 0) {
          console.log(`  ⚠️ No peers connected - torrent might be dead or need more time`);
        }
        
        setTimeout(monitorSwarm, 5000); // Check every 5 seconds
      } catch (error) {
        console.error(`❌ Error monitoring swarm for stream ${streamId}:`, error);
      }
    };

    // Start monitoring after a short delay
    setTimeout(monitorSwarm, 2000);
  }

  startProgressMonitoring(streamId, engine) {
    const monitorProgress = () => {
      if (!this.activeEngines.has(streamId)) {
        // Stream was cleaned up, stop monitoring
        return;
      }

      try {
        const downloaded = engine.swarm?.downloaded || 0;
        const total = engine.torrent?.length || 1;
        const progress = Math.round((downloaded / total) * 100);
        
        console.log(`📈 Progress check - Stream ${streamId}: ${this.formatFileSize(downloaded)} / ${this.formatFileSize(total)} (${progress}%)`);
        streamManager.updateStreamProgress(streamId, progress);
        
        // Continue monitoring every 2 seconds if download isn't complete
        if (progress < 100) {
          setTimeout(monitorProgress, 2000);
        }
      } catch (error) {
        console.error(`❌ Error monitoring progress for stream ${streamId}:`, error);
      }
    };

    // Start monitoring after a short delay
    setTimeout(monitorProgress, 1000);
  }

  async startFFmpegConversion(streamId, videoFile, engine) {
    try {
      console.log(`🔄 Starting FFmpeg conversion for stream ${streamId}`);
      console.log(`📁 Video file: ${videoFile.name}`);
      console.log(`📊 File size: ${this.formatFileSize(videoFile.length)}`);
      
      // Wait for some data to be available
      await this.waitForFileData(videoFile, engine);
      
      const inputPath = path.join(fileService.getStreamDir(streamId), videoFile.name);
      const outputDir = fileService.getHLSDir(streamId);
      
      console.log(`📂 Input path: ${inputPath}`);
      console.log(`📂 Output directory: ${outputDir}`);
      
      // Ensure both directories exist with proper error handling
      try {
        fileService.ensureDir(fileService.getStreamDir(streamId));
        fileService.ensureDir(outputDir);
        console.log(`✅ All directories created successfully`);
      } catch (dirError) {
        throw new Error(`Directory creation failed: ${dirError.message}`);
      }
      
      // Verify input file exists
      if (!require('fs').existsSync(inputPath)) {
        console.log(`⏳ Waiting for input file to be created: ${inputPath}`);
        // Wait a bit more for the file to be created
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (!require('fs').existsSync(inputPath)) {
          throw new Error(`Input file still doesn't exist after waiting: ${inputPath}`);
        }
      }
      
      console.log(`🎬 Starting FFmpeg HLS conversion...`);
      
      ffmpegService.convertToHLS(streamId, inputPath, outputDir)
        .then(() => {
          console.log(`✅ FFmpeg conversion completed for stream ${streamId}`);
          streamManager.updateStreamStatus(streamId, 'ready');
        })
        .catch((error) => {
          console.error(`❌ FFmpeg conversion failed for stream ${streamId}:`, error);
          streamManager.updateStreamStatus(streamId, 'error', error.message);
        });

    } catch (error) {
      console.error(`❌ Failed to start FFmpeg conversion for stream ${streamId}:`, error);
      streamManager.updateStreamStatus(streamId, 'error', error.message);
    }
  }

  async waitForFileData(file, engine, minBytes = 1024 * 1024) { // Wait for 1MB
    return new Promise((resolve) => {
      const checkData = () => {
        const currentDownloaded = file.downloaded || 0;
        const fileSize = file.length || 0;
        const torrentProgress = engine ? Math.round((engine.swarm.downloaded / engine.torrent.length) * 100) : 0;
        
        console.log(`📊 File download status: ${this.formatFileSize(currentDownloaded)} / ${this.formatFileSize(fileSize)} (${Math.round((currentDownloaded / fileSize) * 100)}%)`);
        console.log(`📊 Overall torrent progress: ${torrentProgress}%`);
        
        // If file is fully downloaded or we have enough data, proceed
        // Also proceed if torrent is at least 10% downloaded (should have enough data for streaming)
        if (currentDownloaded >= fileSize || currentDownloaded >= minBytes || torrentProgress >= 10) {
          console.log(`✅ Sufficient data available for FFmpeg conversion (torrent: ${torrentProgress}%, file: ${Math.round((currentDownloaded / fileSize) * 100)}%)`);
          resolve();
        } else {
          console.log(`⏳ Waiting for more data... torrent at ${torrentProgress}%, need at least 10% or 1MB file data`);
          setTimeout(checkData, 1000);
        }
      };
      checkData();
    });
  }

  cleanup(streamId) {
    const engine = this.activeEngines.get(streamId);
    if (engine) {
      engine.destroy();
      this.activeEngines.delete(streamId);
      console.log(`🧹 Cleaned up torrent engine for stream ${streamId}`);
    }
  }

  getDownloadProgress(streamId) {
    const engine = this.activeEngines.get(streamId);
    if (!engine || !engine.torrent) return 0;
    
    const downloaded = engine.swarm?.downloaded || 0;
    const total = engine.torrent?.length || 1;
    return Math.round((downloaded / total) * 100);
  }
}

module.exports = new TorrentService();
