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
      console.log(`🔄 Using sequential download strategy for better streaming compatibility`);
      
      const engine = torrentStream(magnetUrl, {
        tmp: fileService.getTempDir(),
        path: fileService.getStreamDir(streamId),
        connections: 100,     // Allow more connections
        uploads: 10,          // Allow more uploads to get better reciprocation
        verify: true,         // Verify pieces
        dht: true,            // Enable DHT
        tracker: true,        // Enable trackers
        strategy: 'sequential', // Download pieces sequentially from start
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

        // Select the file for download with high priority
        videoFile.select();
        console.log(`✅ Video file selected for download`);
        
        // Set high priority for the video file to download it first
        if (videoFile.priority) {
          videoFile.priority(1); // Highest priority
          console.log(`🔥 Set high priority for video file`);
        }
        
        // If the engine supports it, prioritize downloading from the beginning
        if (engine.selection && engine.selection.from && engine.selection.to) {
          // Select the first part of the video file for immediate download
          const startOffset = videoFile.offset || 0;
          const prioritySize = Math.min(50 * 1024 * 1024, videoFile.length); // First 50MB or entire file
          engine.selection.from = startOffset;
          engine.selection.to = startOffset + prioritySize;
          console.log(`🎯 Prioritizing first ${this.formatFileSize(prioritySize)} of video file`);
        }

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
      
      // Use the actual torrent download path instead of constructed path
      const basePath = fileService.getStreamDir(streamId);
      const actualInputPath = path.join(basePath, videoFile.name);
      
      // Also try the direct path in case torrent-stream puts file directly in basePath
      const alternativeInputPath = path.join(basePath, path.basename(videoFile.name));
      
      console.log(`🔍 Checking for input file at: ${actualInputPath}`);
      console.log(`🔍 Alternative path: ${alternativeInputPath}`);
      
      let inputPath = actualInputPath;
      
      // Check which path actually exists
      if (!require('fs').existsSync(actualInputPath)) {
        if (require('fs').existsSync(alternativeInputPath)) {
          inputPath = alternativeInputPath;
          console.log(`✅ Found input file at alternative path: ${alternativeInputPath}`);
        } else {
          // List directory contents for debugging
          try {
            const files = require('fs').readdirSync(basePath, { recursive: true });
            console.log(`📁 Files in ${basePath}:`, files);
            
            // Try to find the video file by matching name or extension
            const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts', '.m2ts'];
            const foundVideoFile = files.find(file => {
              const ext = path.extname(file).toLowerCase();
              return videoExtensions.includes(ext) && file.includes(path.parse(videoFile.name).name);
            });
            
            if (foundVideoFile) {
              inputPath = path.join(basePath, foundVideoFile);
              console.log(`✅ Found video file by search: ${inputPath}`);
            } else {
              throw new Error(`Video file not found in any expected location. Expected: ${actualInputPath} or ${alternativeInputPath}`);
            }
          } catch (listError) {
            console.error(`❌ Error listing directory contents:`, listError);
            throw new Error(`Input file not found and couldn't list directory: ${actualInputPath}`);
          }
        }
      } else {
        console.log(`✅ Found input file at expected path: ${actualInputPath}`);
      }
      const outputDir = fileService.getHLSDir(streamId);
      
      console.log(`📂 Final input path: ${inputPath}`);
      console.log(`📂 Output directory: ${outputDir}`);
      
      // Ensure both directories exist with proper error handling
      try {
        fileService.ensureDir(fileService.getStreamDir(streamId));
        fileService.ensureDir(outputDir);
        console.log(`✅ All directories created successfully`);
      } catch (dirError) {
        throw new Error(`Directory creation failed: ${dirError.message}`);
      }
      
      // Final verification that input file exists
      if (!require('fs').existsSync(inputPath)) {
        throw new Error(`Input file still doesn't exist after path resolution: ${inputPath}`);
      }
      
      // Verify file is readable and has valid data
      try {
        const stats = require('fs').statSync(inputPath);
        console.log(`📊 Input file size on disk: ${this.formatFileSize(stats.size)}`);
        
        // Try to read the first few bytes to ensure file is accessible and has data
        const fs = require('fs');
        const buffer = Buffer.alloc(1024);
        const fd = fs.openSync(inputPath, 'r');
        const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
        fs.closeSync(fd);
        
        if (bytesRead < 100) {
          throw new Error(`File appears to be empty or too small (only ${bytesRead} bytes readable)`);
        }
        
        // Check if it looks like a valid video file (basic header check)
        const header = buffer.toString('hex', 0, 8);
        console.log(`📋 File header: ${header}`);
        
        // Common video file signatures
        const videoSignatures = [
          '00000018', '00000020', // MP4 variants
          '1a45dfa3', // MKV
          '52494646', // AVI (RIFF)
          '464c5601'  // FLV
        ];
        
        const hasValidSignature = videoSignatures.some(sig => header.toLowerCase().includes(sig.toLowerCase())) 
                                 || header.includes('ftyp') // MP4 ftyp box
                                 || buffer.includes('ftypmp4'); // MP4 signature
        
        if (!hasValidSignature) {
          console.log(`⚠️ Warning: File might not be a standard video format (header: ${header})`);
          // Don't throw error, just warn - some formats might not match
        } else {
          console.log(`✅ File appears to have valid video headers`);
        }
        
      } catch (statError) {
        throw new Error(`Cannot access input file: ${inputPath} - ${statError.message}`);
      }
      
      console.log(`🎬 Starting FFmpeg HLS conversion...`);
      
      ffmpegService.convertToHLS(streamId, inputPath, outputDir)
        .then(() => {
          console.log(`✅ FFmpeg conversion completed for stream ${streamId}`);
          streamManager.updateStreamStatus(streamId, 'ready');
        })
        .catch((error) => {
          console.error(`❌ FFmpeg conversion failed for stream ${streamId}:`, error);
          
          // If file wasn't ready, wait a bit and retry
          if (error.message.includes('FILE_NOT_READY')) {
            console.log(`🔄 File not ready, will retry FFmpeg in 10 seconds for stream ${streamId}`);
            setTimeout(() => {
              this.retryFFmpegConversion(streamId, videoFile, engine, 1);
            }, 10000);
          } else {
            streamManager.updateStreamStatus(streamId, 'error', error.message);
          }
        });

    } catch (error) {
      console.error(`❌ Failed to start FFmpeg conversion for stream ${streamId}:`, error);
      streamManager.updateStreamStatus(streamId, 'error', error.message);
    }
  }

  async retryFFmpegConversion(streamId, videoFile, engine, attempt = 1, maxAttempts = 3) {
    if (attempt > maxAttempts) {
      console.error(`❌ Max FFmpeg retry attempts reached for stream ${streamId}`);
      streamManager.updateStreamStatus(streamId, 'error', 'FFmpeg failed after multiple retry attempts');
      return;
    }

    try {
      console.log(`🔄 FFmpeg retry attempt ${attempt}/${maxAttempts} for stream ${streamId}`);
      
      // Wait for more data
      await this.waitForFileData(videoFile, engine, 8 * 1024 * 1024); // 8MB for retry (sequential should be more reliable)
      
      // Find the file again (path might have changed)
      const basePath = fileService.getStreamDir(streamId);
      const actualInputPath = path.join(basePath, videoFile.name);
      const alternativeInputPath = path.join(basePath, path.basename(videoFile.name));
      
      let inputPath = actualInputPath;
      if (!require('fs').existsSync(actualInputPath) && require('fs').existsSync(alternativeInputPath)) {
        inputPath = alternativeInputPath;
      } else if (!require('fs').existsSync(actualInputPath)) {
        const files = require('fs').readdirSync(basePath, { recursive: true });
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts', '.m2ts'];
        const foundVideoFile = files.find(file => {
          const ext = path.extname(file).toLowerCase();
          return videoExtensions.includes(ext) && file.includes(path.parse(videoFile.name).name);
        });
        if (foundVideoFile) {
          inputPath = path.join(basePath, foundVideoFile);
        }
      }

      const outputDir = fileService.getHLSDir(streamId);
      console.log(`🔄 Retry ${attempt}: Using input path: ${inputPath}`);

      ffmpegService.convertToHLS(streamId, inputPath, outputDir)
        .then(() => {
          console.log(`✅ FFmpeg conversion completed on retry ${attempt} for stream ${streamId}`);
          streamManager.updateStreamStatus(streamId, 'ready');
        })
        .catch((error) => {
          if (error.message.includes('FILE_NOT_READY') && attempt < maxAttempts) {
            console.log(`🔄 Retry ${attempt} failed, will try again in 15 seconds`);
            setTimeout(() => {
              this.retryFFmpegConversion(streamId, videoFile, engine, attempt + 1, maxAttempts);
            }, 15000);
          } else {
            console.error(`❌ FFmpeg retry ${attempt} failed for stream ${streamId}:`, error);
            streamManager.updateStreamStatus(streamId, 'error', `FFmpeg failed after ${attempt} attempts: ${error.message}`);
          }
        });

    } catch (error) {
      console.error(`❌ Error in FFmpeg retry ${attempt} for stream ${streamId}:`, error);
      if (attempt < maxAttempts) {
        setTimeout(() => {
          this.retryFFmpegConversion(streamId, videoFile, engine, attempt + 1, maxAttempts);
        }, 15000);
      } else {
        streamManager.updateStreamStatus(streamId, 'error', error.message);
      }
    }
  }

  async waitForFileData(file, engine, minBytes = 5 * 1024 * 1024) { // Wait for 5MB (reduced since sequential)
    return new Promise((resolve) => {
      const checkData = () => {
        const currentDownloaded = file.downloaded || 0;
        const fileSize = file.length || 0;
        const fileProgress = Math.round((currentDownloaded / fileSize) * 100);
        const torrentProgress = engine ? Math.round((engine.swarm.downloaded / engine.torrent.length) * 100) : 0;
        
        console.log(`📊 File download status: ${this.formatFileSize(currentDownloaded)} / ${this.formatFileSize(fileSize)} (${fileProgress}%)`);
        console.log(`📊 Overall torrent progress: ${torrentProgress}%`);
        
        // With sequential downloading, we can be less conservative
        const hasEnoughFileData = currentDownloaded >= minBytes;
        const fileProgressGood = fileProgress >= 2; // At least 2% of the specific file (reduced from 5%)
        const isComplete = currentDownloaded >= fileSize;
        
        // Also check if we have some reasonable amount of data for the file size
        const minRequiredForSize = Math.min(minBytes, fileSize * 0.02); // 2% or 5MB, whichever is smaller
        
        if (isComplete || (hasEnoughFileData && fileProgressGood) || currentDownloaded >= minRequiredForSize) {
          console.log(`✅ Sufficient file data for FFmpeg (sequential): ${this.formatFileSize(currentDownloaded)} (${fileProgress}% of file)`);
          resolve();
        } else {
          console.log(`⏳ Waiting for sequential file data... file at ${fileProgress}%, need at least 2% AND 5MB (currently ${this.formatFileSize(currentDownloaded)})`);
          setTimeout(checkData, 2000); // Check less frequently
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
