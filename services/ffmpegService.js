const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const streamManager = require('./streamManager');

class FFmpegService {
  constructor() {
    this.activeProcesses = new Map();
  }

  async convertToHLS(streamId, inputPath, outputDir) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`🎞️ Starting HLS conversion for stream ${streamId}`);
        console.log(`📥 Input: ${inputPath}`);
        console.log(`📤 Output: ${outputDir}`);

        const outputPlaylist = path.join(outputDir, 'playlist.m3u8');
        const segmentFilename = path.join(outputDir, 'segment%03d.ts');

        const command = ffmpeg(inputPath)
          .inputOptions([
            '-re', // Read input at its native frame rate
            '-fflags +genpts' // Generate missing PTS
          ])
          .outputOptions([
            '-c:v libx264',           // Video codec
            '-c:a aac',               // Audio codec
            '-preset fast',           // Encoding preset
            '-crf 23',                // Quality setting
            '-maxrate 3000k',         // Max bitrate
            '-bufsize 6000k',         // Buffer size
            '-g 30',                  // GOP size
            '-hls_time 10',           // 10 second segments
            '-hls_list_size 6',       // Keep 6 segments in playlist
            '-hls_flags delete_segments+append_list', // Delete old segments
            '-f hls'                  // HLS format
          ])
          .output(outputPlaylist);

        // Store the process reference
        this.activeProcesses.set(streamId, command);

        command.on('start', (commandLine) => {
          console.log(`▶️ FFmpeg started for stream ${streamId}`);
          console.log(`Command: ${commandLine}`);
          streamManager.updateStreamStatus(streamId, 'converting');
        });

        command.on('progress', (progress) => {
          if (progress.percent) {
            const percent = Math.round(progress.percent);
            console.log(`🔄 FFmpeg progress for stream ${streamId}: ${percent}%`);
            streamManager.updateStreamProgress(streamId, percent);
          }
        });

        command.on('error', (error) => {
          console.error(`❌ FFmpeg error for stream ${streamId}:`, error);
          this.activeProcesses.delete(streamId);
          reject(error);
        });

        command.on('end', () => {
          console.log(`✅ FFmpeg conversion completed for stream ${streamId}`);
          this.activeProcesses.delete(streamId);
          resolve();
        });

        // Start the conversion
        command.run();

      } catch (error) {
        console.error(`❌ Failed to start FFmpeg conversion for stream ${streamId}:`, error);
        reject(error);
      }
    });
  }

  stopConversion(streamId) {
    const process = this.activeProcesses.get(streamId);
    if (process) {
      process.kill('SIGTERM');
      this.activeProcesses.delete(streamId);
      console.log(`🛑 Stopped FFmpeg conversion for stream ${streamId}`);
    }
  }

  isConverting(streamId) {
    return this.activeProcesses.has(streamId);
  }

  getActiveConversions() {
    return Array.from(this.activeProcesses.keys());
  }
}

module.exports = new FFmpegService();
