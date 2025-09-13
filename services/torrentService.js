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
        path: fileService.getStreamDir(streamId)
      });

      this.activeEngines.set(streamId, engine);

      engine.on('ready', () => {
        console.log(`📦 Torrent ready for stream ${streamId}`);
        console.log(`📁 Torrent contains ${engine.files.length} files`);
        console.log(`💾 Total torrent size: ${this.formatFileSize(engine.torrent.length)}`);
        
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

        // Start FFmpeg conversion when file starts downloading
        this.startFFmpegConversion(streamId, videoFile);
      });

      engine.on('download', (index) => {
        const progress = Math.round((engine.swarm.downloaded / engine.torrent.length) * 100);
        streamManager.updateStreamProgress(streamId, progress);
      });

      engine.on('error', (error) => {
        console.error(`❌ Torrent error for stream ${streamId}:`, error);
        streamManager.updateStreamStatus(streamId, 'error', error.message);
        this.cleanup(streamId);
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

  async startFFmpegConversion(streamId, videoFile) {
    try {
      console.log(`🔄 Starting FFmpeg conversion for stream ${streamId}`);
      console.log(`📁 Video file: ${videoFile.name}`);
      console.log(`📊 File size: ${this.formatFileSize(videoFile.length)}`);
      
      // Wait for some data to be available
      await this.waitForFileData(videoFile);
      
      const inputPath = path.join(fileService.getStreamDir(streamId), videoFile.name);
      const outputDir = fileService.getHLSDir(streamId);
      
      console.log(`📂 Input path: ${inputPath}`);
      console.log(`📂 Output directory: ${outputDir}`);
      
      // Ensure output directory exists
      fileService.ensureDir(outputDir);
      
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

  async waitForFileData(file, minBytes = 1024 * 1024) { // Wait for 1MB
    return new Promise((resolve) => {
      const checkData = () => {
        const currentDownloaded = file.downloaded || 0;
        const fileSize = file.length || 0;
        console.log(`📊 File download status: ${this.formatFileSize(currentDownloaded)} / ${this.formatFileSize(fileSize)} (${Math.round((currentDownloaded / fileSize) * 100)}%)`);
        
        // If file is fully downloaded or we have enough data, proceed
        if (currentDownloaded >= fileSize || currentDownloaded >= minBytes) {
          console.log(`✅ Sufficient data available for FFmpeg conversion`);
          resolve();
        } else {
          console.log(`⏳ Waiting for more data... need ${this.formatFileSize(minBytes - currentDownloaded)} more`);
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
    
    return Math.round((engine.swarm.downloaded / engine.torrent.length) * 100);
  }
}

module.exports = new TorrentService();
