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

        // Ensure the input file exists
        if (!require('fs').existsSync(inputPath)) {
          throw new Error(`Input file does not exist: ${inputPath}`);
        }

        // Create and verify output directory
        require('fs-extra').ensureDirSync(outputDir);
        console.log(`✅ Output directory verified: ${outputDir}`);

        const outputPlaylist = path.join(outputDir, 'playlist.m3u8');
        const segmentPattern = path.join(outputDir, 'segment%03d.ts');

        console.log(`📝 Playlist path: ${outputPlaylist}`);
        console.log(`📹 Segment pattern: ${segmentPattern}`);

        const command = ffmpeg(inputPath)
          .inputOptions([
            '-re', // Read input at its native frame rate
            '-fflags +genpts' // Generate missing PTS
          ])
          .outputOptions([
            '-c copy',                // Copy streams without re-encoding (REMUX)
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
          console.error(`❌ FFmpeg error for stream ${streamId}:`, error.message);
          
          // If remuxing failed, try with re-encoding as fallback
          if (error.message.includes('codec') || error.message.includes('format')) {
            console.log(`🔄 Remuxing failed, trying with re-encoding for stream ${streamId}`);
            this.convertToHLSWithEncoding(streamId, inputPath, outputDir)
              .then(resolve)
              .catch(reject);
          } else {
            streamManager.updateStreamStatus(streamId, 'error', error.message);
            this.activeProcesses.delete(streamId);
            reject(error);
          }
        });

        command.on('end', () => {
          console.log(`✅ FFmpeg conversion completed for stream ${streamId}`);
          this.activeProcesses.delete(streamId);
          resolve();
        });

        // Start the conversion
        command.run();

      } catch (error) {
        console.error(`❌ Failed to start FFmpeg for stream ${streamId}:`, error);
        reject(error);
      }
    });
  }

  // Fallback method with re-encoding
  async convertToHLSWithEncoding(streamId, inputPath, outputDir) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`🎞️ Starting HLS conversion with re-encoding for stream ${streamId}`);

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
            '-preset ultrafast',      // Fastest encoding preset
            '-crf 28',                // Lower quality for speed
            '-hls_time 10',           // 10 second segments
            '-hls_list_size 6',       // Keep 6 segments in playlist
            '-hls_flags delete_segments+append_list', // Delete old segments
            '-f hls'                  // HLS format
          ])
          .output(outputPlaylist);

        // Store the process reference
        this.activeProcesses.set(streamId, command);

        command.on('start', (commandLine) => {
          console.log(`▶️ FFmpeg re-encoding started for stream ${streamId}`);
          console.log(`Command: ${commandLine}`);
          streamManager.updateStreamStatus(streamId, 'converting');
        });

        command.on('progress', (progress) => {
          if (progress.percent) {
            const progressPercent = Math.round(progress.percent);
            console.log(`🔄 FFmpeg progress for stream ${streamId}: ${progressPercent}%`);
            streamManager.updateFFmpegProgress(streamId, progressPercent);
          }
        });

        command.on('error', (error) => {
          console.error(`❌ FFmpeg re-encoding error for stream ${streamId}:`, error.message);
          streamManager.updateStreamStatus(streamId, 'error', error.message);
          this.activeProcesses.delete(streamId);
          reject(error);
        });

        command.on('end', () => {
          console.log(`✅ FFmpeg re-encoding completed for stream ${streamId}`);
          this.activeProcesses.delete(streamId);
          resolve();
        });

        // Start the conversion
        command.run();

      } catch (error) {
        console.error(`❌ Failed to start FFmpeg re-encoding for stream ${streamId}:`, error);
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
