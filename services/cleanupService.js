const streamManager = require('./streamManager');
const fileService = require('./fileService');
const torrentService = require('./torrentService');
const ffmpegService = require('./ffmpegService');

class CleanupService {
  constructor() {
    this.cleanupInterval = null;
    this.isRunning = false;
  }

  startCleanupScheduler(intervalMinutes = 10, maxAgeMinutes = 30) {
    if (this.isRunning) {
      console.log('⚠️ Cleanup scheduler is already running');
      return;
    }

    this.isRunning = true;
    const intervalMs = intervalMinutes * 60 * 1000; // Convert to milliseconds

    console.log(`🧹 Starting cleanup scheduler (every ${intervalMinutes} minutes, max age ${maxAgeMinutes} minutes)`);

    this.cleanupInterval = setInterval(async () => {
      await this.performCleanup(maxAgeMinutes);
    }, intervalMs);

    // Perform initial cleanup
    setTimeout(() => this.performCleanup(maxAgeMinutes), 5000);
  }

  stopCleanupScheduler() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.isRunning = false;
      console.log('🛑 Cleanup scheduler stopped');
    }
  }

  async performCleanup(maxAgeMinutes = 30) {
    try {
      console.log(`🧹 Starting cleanup process (max age: ${maxAgeMinutes} minutes)`);

      const startTime = Date.now();
      
      // Get old streams before cleanup
      const oldStreams = streamManager.getOldStreams(maxAgeMinutes);
      
      if (oldStreams.length === 0) {
        console.log('✅ No old streams to clean up');
        return;
      }

      console.log(`🗑️ Found ${oldStreams.length} old streams to clean up`);

      // Stop any active torrent downloads and FFmpeg processes
      for (const stream of oldStreams) {
        try {
          // Stop torrent download
          torrentService.cleanup(stream.id);
          
          // Stop FFmpeg conversion
          if (ffmpegService.isConverting(stream.id)) {
            ffmpegService.stopConversion(stream.id);
          }
          
          // Delete files
          await fileService.deleteStream(stream.id);
          
          // Remove from stream manager
          streamManager.removeStream(stream.id);
          
          console.log(`✅ Cleaned up stream ${stream.id}`);
          
        } catch (error) {
          console.error(`❌ Error cleaning up stream ${stream.id}:`, error);
        }
      }

      // Clean up any remaining old files
      await fileService.cleanupOldFiles(maxAgeMinutes);

      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`✅ Cleanup completed in ${duration}ms. Cleaned ${oldStreams.length} streams.`);
      
      // Log current stats
      const stats = streamManager.getStats();
      console.log(`📊 Current streams: ${stats.totalStreams}, Status breakdown:`, stats.statusCounts);

    } catch (error) {
      console.error('❌ Error during cleanup process:', error);
    }
  }

  async forceCleanup(streamId) {
    try {
      console.log(`🧹 Force cleaning stream ${streamId}`);

      const stream = streamManager.getStream(streamId);
      if (!stream) {
        console.log(`⚠️ Stream ${streamId} not found in manager`);
        return false;
      }

      // Stop torrent download
      torrentService.cleanup(streamId);
      
      // Stop FFmpeg conversion
      if (ffmpegService.isConverting(streamId)) {
        ffmpegService.stopConversion(streamId);
      }
      
      // Delete files
      await fileService.deleteStream(streamId);
      
      // Remove from stream manager
      streamManager.removeStream(streamId);
      
      console.log(`✅ Force cleaned stream ${streamId}`);
      return true;

    } catch (error) {
      console.error(`❌ Error force cleaning stream ${streamId}:`, error);
      return false;
    }
  }

  async getCleanupStats() {
    try {
      const oldStreams = streamManager.getOldStreams(30);
      const totalStreams = streamManager.getStats().totalStreams;
      const activeConversions = ffmpegService.getActiveConversions();

      return {
        totalStreams,
        oldStreams: oldStreams.length,
        activeConversions: activeConversions.length,
        schedulerRunning: this.isRunning
      };
    } catch (error) {
      console.error('❌ Error getting cleanup stats:', error);
      return null;
    }
  }
}

module.exports = new CleanupService();
