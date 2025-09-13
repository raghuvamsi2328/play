const fs = require('fs-extra');
const path = require('path');

class FileService {
  constructor() {
    this.tempDir = path.join(__dirname, '..', 'temp');
    this.ensureDir(this.tempDir);
  }

  getTempDir() {
    return this.tempDir;
  }

  getStreamDir(streamId) {
    return path.join(this.tempDir, 'streams', streamId);
  }

  getHLSDir(streamId) {
    return path.join(this.tempDir, 'hls', streamId);
  }

  getHLSPlaylistPath(streamId) {
    return path.join(this.getHLSDir(streamId), 'playlist.m3u8');
  }

  getHLSFilePath(streamId, filename) {
    return path.join(this.getHLSDir(streamId), filename);
  }

  ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`📁 Created directory: ${dirPath}`);
    }
  }

  fileExists(filePath) {
    return fs.existsSync(filePath);
  }

  async getFileStats(filePath) {
    return fs.stat(filePath);
  }

  createReadStream(filePath, options = {}) {
    return fs.createReadStream(filePath, options);
  }

  async deleteStream(streamId) {
    try {
      const streamDir = this.getStreamDir(streamId);
      const hlsDir = this.getHLSDir(streamId);

      // Delete stream directory
      if (fs.existsSync(streamDir)) {
        await fs.remove(streamDir);
        console.log(`🗑️ Deleted stream directory: ${streamDir}`);
      }

      // Delete HLS directory
      if (fs.existsSync(hlsDir)) {
        await fs.remove(hlsDir);
        console.log(`🗑️ Deleted HLS directory: ${hlsDir}`);
      }

    } catch (error) {
      console.error(`❌ Error deleting stream ${streamId}:`, error);
    }
  }

  async getStreamSize(streamId) {
    try {
      const streamDir = this.getStreamDir(streamId);
      const hlsDir = this.getHLSDir(streamId);
      
      let totalSize = 0;

      // Calculate stream directory size
      if (fs.existsSync(streamDir)) {
        const streamFiles = await this.getDirectorySize(streamDir);
        totalSize += streamFiles;
      }

      // Calculate HLS directory size
      if (fs.existsSync(hlsDir)) {
        const hlsFiles = await this.getDirectorySize(hlsDir);
        totalSize += hlsFiles;
      }

      return totalSize;
    } catch (error) {
      console.error(`❌ Error calculating size for stream ${streamId}:`, error);
      return 0;
    }
  }

  async getDirectorySize(dirPath) {
    let totalSize = 0;

    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isDirectory()) {
          totalSize += await this.getDirectorySize(filePath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (error) {
      console.error(`❌ Error reading directory ${dirPath}:`, error);
    }

    return totalSize;
  }

  async cleanupOldFiles(maxAgeMinutes = 30) {
    try {
      const streamsDir = path.join(this.tempDir, 'streams');
      const hlsDir = path.join(this.tempDir, 'hls');
      
      const now = new Date();
      const maxAge = maxAgeMinutes * 60 * 1000; // Convert to milliseconds

      // Clean up streams directory
      await this.cleanupDirectory(streamsDir, now, maxAge);
      
      // Clean up HLS directory
      await this.cleanupDirectory(hlsDir, now, maxAge);

    } catch (error) {
      console.error('❌ Error during file cleanup:', error);
    }
  }

  async cleanupDirectory(dirPath, now, maxAge) {
    try {
      if (!fs.existsSync(dirPath)) return;

      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = await fs.stat(itemPath);
        
        const age = now - stats.mtime;
        
        if (age > maxAge) {
          await fs.remove(itemPath);
          console.log(`🗑️ Cleaned up old file/directory: ${itemPath}`);
        }
      }
    } catch (error) {
      console.error(`❌ Error cleaning directory ${dirPath}:`, error);
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = new FileService();
