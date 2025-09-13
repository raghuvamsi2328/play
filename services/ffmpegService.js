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
        const fs = require('fs');
        const fsExtra = require('fs-extra');
        
        console.log(`🔍 Checking output directory: ${outputDir}`);
        
        // Ensure directory exists with multiple methods
        try {
          fsExtra.ensureDirSync(outputDir);
          
          // Double-check with native fs
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true, mode: 0o755 });
          }
          
          // Verify it's actually a directory
          const stats = fs.statSync(outputDir);
          if (!stats.isDirectory()) {
            throw new Error(`Output path exists but is not a directory: ${outputDir}`);
          }
          
          console.log(`✅ Output directory verified: ${outputDir}`);
        } catch (dirError) {
          console.error(`❌ Directory creation failed:`, dirError);
          throw new Error(`Cannot create output directory: ${outputDir} - ${dirError.message}`);
        }

        const outputPlaylist = path.join(outputDir, 'playlist.m3u8');
        const segmentPattern = path.join(outputDir, 'segment%03d.ts');

        console.log(`📝 Playlist path: ${outputPlaylist}`);
        console.log(`📹 Segment pattern: ${segmentPattern}`);
        
        // Validate paths don't contain problematic characters
        if (outputPlaylist.includes('"') || outputPlaylist.includes("'") || segmentPattern.includes('"') || segmentPattern.includes("'")) {
          throw new Error(`Output paths contain problematic characters: ${outputPlaylist}`);
        }

        // Test if we can actually create files in the output directory
        const testFile = path.join(outputDir, 'test.txt');
        try {
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
          console.log(`✅ Write test successful in: ${outputDir}`);
        } catch (writeError) {
          throw new Error(`Cannot write to output directory: ${outputDir} - ${writeError.message}`);
        }

        const command = ffmpeg(inputPath)
          .format('hls')
          .outputOptions([
            '-hls_time 10',
            '-hls_list_size 6', 
            '-c copy',
            '-avoid_negative_ts make_zero',
            '-y',
            '-fflags +genpts', // Generate PTS if missing
            '-movflags +faststart' // Enable fast start for better streaming
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
            
            // Update status to ready once we have some segments
            if (percent >= 10) {
              streamManager.updateStreamStatus(streamId, 'ready');
            }
          } else if (progress.frames) {
            // For files without duration info, estimate based on frames
            console.log(`🔄 FFmpeg processing frames: ${progress.frames}`);
            streamManager.updateStreamStatus(streamId, 'ready'); // Set ready immediately when processing frames
          }
        });

        command.on('error', (error) => {
          console.error(`❌ FFmpeg error for stream ${streamId}:`, error.message);
          
          // Check if it's an input file issue (file not ready yet)
          if (error.message.includes('Invalid data found when processing input') || 
              error.message.includes('Error opening input file')) {
            console.log(`🔄 Input file might not be ready yet for stream ${streamId}, this is expected during torrent download`);
            streamManager.updateStreamStatus(streamId, 'waiting_for_data', 'Waiting for more torrent data...');
            this.activeProcesses.delete(streamId);
            reject(new Error('FILE_NOT_READY: ' + error.message));
          }
          // If remuxing failed due to codec/format issues, try with re-encoding as fallback
          else if (error.message.includes('codec') || error.message.includes('format')) {
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
