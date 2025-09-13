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
      console.log(`🔄 Using enhanced tracker configuration for better peer discovery`);
      
      // Perform network diagnostics first
      await this.performNetworkDiagnostics(magnetUrl);
      
      const engine = torrentStream(magnetUrl, {
        tmp: fileService.getTempDir(),
        path: fileService.getStreamDir(streamId),
        connections: 200,     // Increased connections
        uploads: 20,          // Increased uploads for better reciprocation
        verify: true,         // Verify pieces
        dht: true,            // Enable DHT
        tracker: true,        // Enable trackers
        // UDP Port Configuration for BitTorrent
        port: 6881,           // Fixed UDP port for BitTorrent (instead of random)
        dhtPort: 6882,        // Fixed DHT port (UDP)
        torrentPort: 6881,    // Explicit torrent port
        // Additional network options
        maxConns: 200,        // Maximum connections
        secure: false,        // Don't require encryption (more compatibility)
        // Timeout settings for better connectivity
        trackerTimeout: 10000,  // 10 second tracker timeout
        dhtTimeout: 5000,      // 5 second DHT timeout
        // Note: 'sequential' strategy might not be supported in all versions
        // If download stalls, we'll fall back to default behavior
        trackers: [           // Enhanced tracker list with more reliable trackers
          'udp://tracker.openbittorrent.com:80',
          'udp://tracker.opentrackr.org:1337/announce',
          'udp://9.rarbg.com:2810/announce',
          'udp://tracker.coppersurfer.tk:6969/announce',
          'udp://exodus.desync.com:6969/announce',
          'udp://tracker.torrent.eu.org:451/announce',
          'udp://open.stealth.si:80/announce',
          'udp://tracker.tiny-vps.com:6969/announce',
          'udp://fasttracker.foreverpirates.co:6969/announce',
          'udp://tracker.cyberia.is:6969/announce',
          'udp://ipv4.tracker.harry.lu:80/announce',
          'udp://tracker.zer0day.to:1337/announce',
          'udp://tracker.leechers-paradise.org:6969/announce',
          'udp://coppersurfer.tk:6969/announce',
          // HTTP trackers as backup
          'http://tracker.opentrackr.org:1337/announce',
          'http://9.rarbg.com:2810/announce'
        ]
      });
      
      console.log(`📋 Torrent engine created with enhanced tracker list`);

      this.activeEngines.set(streamId, engine);

      engine.on('ready', () => {
        console.log(`📦 Torrent ready for stream ${streamId}`);
        console.log(`📁 Torrent contains ${engine.files.length} files`);
        console.log(`💾 Total torrent size: ${this.formatFileSize(engine.torrent.length)}`);
        console.log(`🔗 Torrent info hash: ${engine.torrent.infoHash}`);
        console.log(`👥 Initial peers: ${engine.swarm.wires.length}`);
        
        // Enhanced network diagnostics
        console.log(`🌐 Network diagnostics:`);
        console.log(`  📡 DHT enabled: ${engine.dht ? 'Yes' : 'No'}`);
        console.log(`  📊 Tracker count: ${engine.torrent.announce ? engine.torrent.announce.length : 0}`);
        console.log(`  🔗 Magnet URI trackers: ${magnetUrl.match(/tr=/g)?.length || 0}`);
        
        // Log UDP port information
        if (engine.swarm) {
          console.log(`🔌 Network ports:`);
          console.log(`  📡 BitTorrent port: ${engine.swarm.port || 6881} (UDP/TCP)`);
          console.log(`  🌐 DHT port: ${engine.dht?.port || 6882} (UDP)`);
          
          // Show listening status
          if (engine.swarm.listening) {
            console.log(`  ✅ Swarm is listening for incoming connections`);
          } else {
            console.log(`  ⚠️ Swarm not yet listening - this may affect peer discovery`);
          }
        }
        
        // Check if we're behind NAT
        console.log(`🔍 NAT/Firewall status:`);
        console.log(`  📥 Incoming connections: ${engine.swarm?.wires?.filter(wire => wire.incoming).length || 0}`);
        console.log(`  📤 Outgoing connections: ${engine.swarm?.wires?.filter(wire => !wire.incoming).length || 0}`);
        
        // Force tracker announces immediately
        if (engine.swarm && engine.swarm._trackers) {
          console.log(`🚀 Forcing tracker announces for better peer discovery...`);
          engine.swarm._trackers.forEach((tracker, index) => {
            if (tracker && typeof tracker.announce === 'function') {
              console.log(`📡 Announcing to tracker ${index + 1}: ${tracker.announce.uri || 'unknown'}`);
              try {
                tracker.announce();
              } catch (e) {
                console.log(`⚠️ Failed to announce to tracker: ${e.message}`);
              }
            }
          });
        }
        
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
        
        // Try to set high priority for the video file (if supported)
        try {
          if (typeof videoFile.priority === 'function') {
            videoFile.priority(1); // Highest priority
            console.log(`🔥 Set high priority for video file`);
          } else if (videoFile.priority !== undefined) {
            videoFile.priority = 1;
            console.log(`🔥 Set high priority property for video file`);
          }
        } catch (priorityError) {
          console.log(`⚠️ Could not set file priority (not supported): ${priorityError.message}`);
        }
        
        // IMPORTANT: Deselect all other files to focus bandwidth on our target video
        engine.files.forEach((file, index) => {
          if (file !== videoFile) {
            try {
              file.deselect();
              console.log(`🚫 Deselected file: ${file.name}`);
            } catch (e) {
              // Some torrent libraries don't support deselect
              console.log(`⚠️ Could not deselect ${file.name}: ${e.message}`);
            }
          }
        });
        
        console.log(`🎯 Focus set on single video file: ${videoFile.name}`);
        
        // Force the engine to start downloading our selected file immediately
        console.log(`🚀 Starting focused download of ${videoFile.name}`);
        
        // Monitor file-specific download progress
        // this.startFileProgressMonitoring(streamId, videoFile, engine);

        // Start periodic progress checking
        // this.startProgressMonitoring(streamId, engine);
        
        // Start swarm monitoring
        // this.startSwarmMonitoring(streamId, engine);

        // Start FFmpeg conversion when file starts downloading
        this.startFFmpegConversion(streamId, videoFile, engine);
        
        // Add a health check timer to detect if torrent is stalled
        this.startHealthCheck(streamId, engine, videoFile);
        
        // Start aggressive peer discovery
        this.startPeerDiscovery(streamId, engine, magnetUrl);
      });

      engine.on('download', (index) => {
        // More robust progress calculation
        const downloaded = engine.swarm?.downloaded || 0;
        const total = engine.torrent?.length || 1;
        const progress = Math.round((downloaded / total) * 100);
        
        // Get info about which file is being downloaded
        const fileIndex = engine.torrent.pieces[index]?.file || 0;
        const downloadingFile = engine.files[fileIndex];
        
        // Simplified logging - only show every 5% progress or if it's our video file
        if (progress % 5 === 0 || progress === 1 || (downloadingFile && downloadingFile.name === videoFile.name)) {
          console.log(`📥 Downloaded: ${this.formatFileSize(downloaded)} / ${this.formatFileSize(total)} (${progress}%)`);
          
          if (downloadingFile) {
            console.log(`📄 Currently downloading: ${downloadingFile.name}`);
          }
        }
        
        streamManager.updateStreamProgress(streamId, progress);
        
        // Check if our target video file has started downloading
        if (videoFile) {
          const videoDownloaded = videoFile.downloaded || 0;
          const videoProgress = videoFile.length > 0 ? Math.round((videoDownloaded / videoFile.length) * 100) : 0;
          
          if (videoProgress > 0 && videoProgress % 10 === 0) {
            console.log(`🎬 Target video progress: ${this.formatFileSize(videoDownloaded)} / ${this.formatFileSize(videoFile.length)} (${videoProgress}%)`);
          }
        }
      });

      engine.on('error', (error) => {
        console.error(`❌ Torrent error for stream ${streamId}:`, error);
        streamManager.updateStreamStatus(streamId, 'error', error.message);
        this.cleanup(streamId);
      });

      // Add more detailed event logging
      engine.on('peer', (peer) => {
        // Enhanced peer connection logging
        const peerCount = engine.swarm?.wires?.length || 0;
        console.log(`👋 Peer #${peerCount} connected: ${peer.remoteAddress} (${peer.type || 'unknown'})`);
        
        // Log peer details for troubleshooting
        if (peerCount <= 3) {
          console.log(`  � Peer info: ${JSON.stringify({
            address: peer.remoteAddress,
            port: peer.remotePort,
            type: peer.type,
            incoming: peer.incoming
          })}`);
        }
        
        // Celebrate first peer connection
        if (peerCount === 1) {
          console.log(`🎉 First peer connected! Peer discovery successful!`);
        }
      });

      engine.on('noPeers', () => {
        console.log(`😞 No peers event triggered for stream ${streamId}`);
        console.log(`🔍 Troubleshooting peer discovery issues...`);
        
        // Provide troubleshooting information
        console.log(`💡 Troubleshooting tips:`);
        console.log(`  1. Check if your router allows BitTorrent traffic`);
        console.log(`  2. Try disabling any VPN that might be blocking peers`);
        console.log(`  3. Check if your ISP blocks BitTorrent ports`);
        console.log(`  4. The torrent might be old with few active seeders`);
        console.log(`  5. Try the same magnet URL in a regular torrent client`);
      });

      // Monitor when pieces are downloaded
      // engine.on('hotswap', () => {
      //   console.log(`🔥 Hotswap event for stream ${streamId}`);
      // });

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
    
    // First pass: find all potential video files
    const allVideoFiles = files
      .filter(file => {
        const ext = path.extname(file.name).toLowerCase();
        const fileName = path.basename(file.name).toLowerCase();
        
        // Check if it's a video file
        const isVideo = videoExtensions.includes(ext);
        
        // Skip sample/trailer files (usually smaller promotional videos)
        const isSample = excludePatterns.some(pattern => fileName.includes(pattern));
        
        if (isVideo) {
          console.log(`🎬 Found video file: ${file.name} (${this.formatFileSize(file.length)}) - ${isSample ? 'SAMPLE/TRAILER' : 'VALID'}`);
        }
        
        return isVideo && !isSample;
      });
    
    if (allVideoFiles.length === 0) {
      console.log('❌ No video files found');
      console.log('📋 All files in torrent:');
      files.forEach(file => {
        const ext = path.extname(file.name).toLowerCase();
        console.log(`   - ${file.name} (${this.formatFileSize(file.length)}) [${ext || 'no extension'}]`);
      });
      return null;
    }
    
    // Second pass: apply size filter but be more flexible
    const minSizeBytes = 10 * 1024 * 1024; // Reduce minimum to 10MB
    const largeVideoFiles = allVideoFiles.filter(file => file.length >= minSizeBytes);
    
    let videoFiles = largeVideoFiles;
    
    // If no large files, take the largest available video files
    if (largeVideoFiles.length === 0) {
      console.log(`⚠️ No video files >= 10MB found, selecting from all video files`);
      videoFiles = allVideoFiles;
    }
    
    // Sort by size, largest first
    videoFiles.sort((a, b) => b.length - a.length);
    
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

  // Commented out for single stream debugging
  // startSwarmMonitoring(streamId, engine) {
  //   const monitorSwarm = () => {
  //     if (!this.activeEngines.has(streamId)) {
  //       return;
  //     }

  //     try {
  //       const swarm = engine.swarm;
  //       const peers = swarm.wires.length;
  //       const activePeers = swarm.wires.filter(wire => !wire.peerChoking).length;
  //       const downloadSpeed = Math.round(swarm.downloadSpeed() / 1024); // KB/s
  //       const uploadSpeed = Math.round(swarm.uploadSpeed() / 1024); // KB/s
        
  //       console.log(`🕸️ Swarm status - Stream ${streamId}:`);
  //       console.log(`  👥 Peers: ${peers} (${activePeers} active)`);
  //       console.log(`  ⬇️ Download: ${downloadSpeed} KB/s`);
  //       console.log(`  ⬆️ Upload: ${uploadSpeed} KB/s`);
  //       console.log(`  📊 Downloaded: ${this.formatFileSize(swarm.downloaded)}`);
        
  //       if (peers === 0) {
  //         console.log(`  ⚠️ No peers connected - torrent might be dead or need more time`);
  //       }
        
  //       setTimeout(monitorSwarm, 5000); // Check every 5 seconds
  //     } catch (error) {
  //       console.error(`❌ Error monitoring swarm for stream ${streamId}:`, error);
  //     }
  //   };

  //   // Start monitoring after a short delay
  //   setTimeout(monitorSwarm, 2000);
  // }

  // Commented out for single stream debugging
  // startProgressMonitoring(streamId, engine) {
  //   const monitorProgress = () => {
  //     if (!this.activeEngines.has(streamId)) {
  //       // Stream was cleaned up, stop monitoring
  //       return;
  //     }

  //     try {
  //       const downloaded = engine.swarm?.downloaded || 0;
  //       const total = engine.torrent?.length || 1;
  //       const progress = Math.round((downloaded / total) * 100);
        
  //       console.log(`📈 Progress check - Stream ${streamId}: ${this.formatFileSize(downloaded)} / ${this.formatFileSize(total)} (${progress}%)`);
  //       streamManager.updateStreamProgress(streamId, progress);
        
  //       // Continue monitoring every 2 seconds if download isn't complete
  //       if (progress < 100) {
  //         setTimeout(monitorProgress, 2000);
  //       }
  //     } catch (error) {
  //       console.error(`❌ Error monitoring progress for stream ${streamId}:`, error);
  //     }
  //   };

  //   // Start monitoring after a short delay
  //   setTimeout(monitorProgress, 1000);
  // }

  // Commented out for single stream debugging
  // startFileProgressMonitoring(streamId, videoFile, engine) {
  //   const monitorFileProgress = () => {
  //     if (!this.activeEngines.has(streamId)) {
  //       return;
  //     }

  //     try {
  //       const fileDownloaded = videoFile.downloaded || 0;
  //       const fileSize = videoFile.length || 0;
  //       const fileProgress = fileSize > 0 ? Math.round((fileDownloaded / fileSize) * 100) : 0;
        
  //       // Also check actual file on disk
  //       const basePath = fileService.getStreamDir(streamId);
  //       const filePaths = [
  //         path.join(basePath, videoFile.name),
  //         path.join(basePath, path.basename(videoFile.name))
  //       ];
        
  //       let diskFileSize = 0;
  //       for (const filePath of filePaths) {
  //         try {
  //           if (require('fs').existsSync(filePath)) {
  //             diskFileSize = require('fs').statSync(filePath).size;
  //             break;
  //           }
  //         } catch (e) {
  //           // Continue checking
  //         }
  //       }
        
  //       console.log(`📁 File progress - Stream ${streamId}:`);
  //       console.log(`   🎬 File: ${videoFile.name}`);
  //       console.log(`   📊 Torrent reports: ${this.formatFileSize(fileDownloaded)} / ${this.formatFileSize(fileSize)} (${fileProgress}%)`);
  //       console.log(`   💾 Disk has: ${this.formatFileSize(diskFileSize)}`);
        
  //       const effectiveProgress = Math.max(fileProgress, Math.round((diskFileSize / fileSize) * 100));
  //       console.log(`   📈 Effective: ${effectiveProgress}%`);
        
  //       if (fileDownloaded === 0 && diskFileSize === 0) {
  //         console.log(`   ⚠️ No file data detected - checking torrent health`);
          
  //         const peers = engine.swarm?.wires?.length || 0;
  //         const downloadSpeed = engine.swarm?.downloadSpeed ? Math.round(engine.swarm.downloadSpeed() / 1024) : 0;
          
  //         if (peers === 0) {
  //           console.log(`   🔍 No peers connected - torrent might be dead or need more time`);
  //         } else if (downloadSpeed === 0) {
  //           console.log(`   ⏸️ Peers connected (${peers}) but no download speed - they might not have the file`);
  //         }
  //       }
        
  //       setTimeout(monitorFileProgress, 3000); // Check every 3 seconds
  //     } catch (error) {
  //       console.error(`❌ Error monitoring file progress for stream ${streamId}:`, error);
  //     }
  //   };

  //   // Start monitoring after a short delay
  //   setTimeout(monitorFileProgress, 2000);
  // }

  async startFFmpegConversion(streamId, videoFile, engine) {
    try {
      console.log(`🔄 Starting FFmpeg conversion for stream ${streamId}`);
      console.log(`📁 Video file: ${videoFile.name}`);
      console.log(`📊 File size: ${this.formatFileSize(videoFile.length)}`);
      
      // Wait for some data to be available
      await this.waitForFileData(videoFile, engine, streamId);
      
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
      await this.waitForFileData(videoFile, engine, streamId, 8 * 1024 * 1024); // 8MB for retry (sequential should be more reliable)
      
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

  async waitForFileData(file, engine, streamId, minBytes = 2 * 1024 * 1024, maxWaitTime = 60000) { // Wait for 2MB, max 60 seconds
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkData = () => {
        // Get file download status from multiple sources
        const currentDownloaded = file.downloaded || 0;
        const fileSize = file.length || 0;
        const fileProgress = fileSize > 0 ? Math.round((currentDownloaded / fileSize) * 100) : 0;
        const torrentProgress = engine ? Math.round((engine.swarm.downloaded / engine.torrent.length) * 100) : 0;
        
        // Also check actual file size on disk as fallback
        let actualFileSize = 0;
        const basePath = require('./fileService').getStreamDir(streamId);
        const possiblePaths = [
          require('path').join(basePath, file.name),
          require('path').join(basePath, require('path').basename(file.name))
        ];
        
        for (const filePath of possiblePaths) {
          try {
            if (require('fs').existsSync(filePath)) {
              const stats = require('fs').statSync(filePath);
              actualFileSize = stats.size;
              console.log(`💾 Found file on disk: ${filePath} (${this.formatFileSize(actualFileSize)})`);
              break;
            }
          } catch (e) {
            // Ignore errors, continue checking
          }
        }
        
        // Use the larger of the two values (torrent tracking vs file system)
        const effectiveDownloaded = Math.max(currentDownloaded, actualFileSize);
        const effectiveProgress = fileSize > 0 ? Math.round((effectiveDownloaded / fileSize) * 100) : 0;
        
        const elapsed = Date.now() - startTime;
        console.log(`📊 Waiting for file data (${Math.round(elapsed/1000)}s): ${this.formatFileSize(effectiveDownloaded)} / ${this.formatFileSize(fileSize)} (${effectiveProgress}%) | Torrent: ${torrentProgress}%`);
        
        // Check torrent health
        const peers = engine.swarm?.wires?.length || 0;
        const downloadSpeed = engine.swarm?.downloadSpeed ? Math.round(engine.swarm.downloadSpeed() / 1024) : 0;
        
        if (peers > 0 || downloadSpeed > 0) {
          console.log(`🌐 Torrent health: ${peers} peers, ${downloadSpeed} KB/s`);
        }
        
        // More flexible conditions - reduced requirements
        const minRequiredBytes = Math.min(minBytes, fileSize * 0.01, 1024 * 1024); // At least 1MB or 1% of file
        const hasMinimumData = effectiveDownloaded >= minRequiredBytes;
        const hasAnyProgress = effectiveDownloaded > 50 * 1024; // At least 50KB
        const isComplete = effectiveDownloaded >= fileSize;
        
        // Allow FFmpeg to start with very little data for better streaming experience
        if (isComplete) {
          console.log(`✅ File complete for FFmpeg: ${this.formatFileSize(effectiveDownloaded)}`);
          resolve();
        } else if (hasMinimumData) {
          console.log(`✅ Sufficient file data for FFmpeg: ${this.formatFileSize(effectiveDownloaded)} (${effectiveProgress}% of file)`);
          resolve();
        } else if (hasAnyProgress) {
          console.log(`⏳ Some data available (${this.formatFileSize(effectiveDownloaded)}), waiting for more...`);
          
          // If we have some data but it's taking too long, try with what we have
          if (elapsed > maxWaitTime / 2 && effectiveDownloaded > 0) {
            console.log(`🚀 Starting FFmpeg with available data due to timeout`);
            resolve();
          } else {
            setTimeout(checkData, 1500);
          }
        } else if (elapsed > maxWaitTime) {
          console.log(`⏰ Timeout waiting for file data after ${Math.round(elapsed/1000)}s`);
          
          // Check if torrent is dead
          if (peers === 0 && downloadSpeed === 0) {
            reject(new Error(`Torrent appears to be dead - no peers and no download progress after ${Math.round(elapsed/1000)}s`));
          } else {
            // Try with whatever we have
            console.log(`🚀 Attempting FFmpeg with current data (${this.formatFileSize(effectiveDownloaded)})`);
            resolve();
          }
        } else {
          if (peers === 0) {
            console.log(`🔍 No peers connected - waiting for peer discovery...`);
          } else if (downloadSpeed === 0) {
            console.log(`⏸️ Connected to ${peers} peers but no download - they might not have this file`);
          } else {
            console.log(`⏳ Downloading at ${downloadSpeed} KB/s from ${peers} peers...`);
          }
          setTimeout(checkData, 2000);
        }
      };
      
      // Start checking immediately
      checkData();
    });
  }

  startHealthCheck(streamId, engine, videoFile) {
    let lastDownloaded = 0;
    let stallCount = 0;
    
    const healthCheck = () => {
      if (!this.activeEngines.has(streamId)) {
        return; // Stream was cleaned up
      }
      
      try {
        const currentDownloaded = engine.swarm?.downloaded || 0;
        const peers = engine.swarm?.wires?.length || 0;
        const downloadSpeed = engine.swarm?.downloadSpeed ? Math.round(engine.swarm.downloadSpeed() / 1024) : 0;
        const videoDownloaded = videoFile.downloaded || 0;
        
        // Check if download is progressing
        if (currentDownloaded > lastDownloaded) {
          lastDownloaded = currentDownloaded;
          stallCount = 0;
          console.log(`💚 Torrent health check: Active download (${downloadSpeed} KB/s from ${peers} peers)`);
        } else {
          stallCount++;
          console.log(`⚠️ Torrent health check: Stalled for ${stallCount * 10}s (${peers} peers, ${downloadSpeed} KB/s)`);
          
          // If stalled for too long, try to help
          if (stallCount >= 3) { // 30 seconds stalled
            console.log(`🚨 Torrent appears stalled, attempting recovery...`);
            
            // Try to reconnect to swarm
            if (engine.swarm && typeof engine.swarm.pause === 'function') {
              engine.swarm.pause();
              setTimeout(() => {
                if (this.activeEngines.has(streamId)) {
                  engine.swarm.resume();
                  console.log(`🔄 Attempted swarm reconnect for stream ${streamId}`);
                }
              }, 2000);
            }
            
            stallCount = 0; // Reset counter after attempting recovery
          }
          
          // If no peers and stalled for a while, declare torrent dead
          if (peers === 0 && stallCount >= 6) { // 60 seconds with no peers
            console.log(`💀 Torrent appears dead - no peers for ${stallCount * 10}s`);
            streamManager.updateStreamStatus(streamId, 'error', 'Torrent appears to be dead (no peers found)');
            this.cleanup(streamId);
            return;
          }
        }
        
        // Continue health checks
        setTimeout(healthCheck, 10000); // Check every 10 seconds
        
      } catch (error) {
        console.error(`❌ Health check error for stream ${streamId}:`, error);
      }
    };
    
    // Start health check after initial connection period
    setTimeout(healthCheck, 15000);
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

  startPeerDiscovery(streamId, engine, magnetUrl) {
    console.log(`🔍 Starting aggressive peer discovery for stream ${streamId}`);
    
    let discoveryAttempts = 0;
    const maxDiscoveryAttempts = 5;
    
    const attemptPeerDiscovery = () => {
      if (!this.activeEngines.has(streamId) || discoveryAttempts >= maxDiscoveryAttempts) {
        return;
      }
      
      discoveryAttempts++;
      const peers = engine.swarm?.wires?.length || 0;
      
      console.log(`🔍 Peer discovery attempt ${discoveryAttempts}/${maxDiscoveryAttempts} - Current peers: ${peers}`);
      
      if (peers === 0) {
        // Try to re-announce to all trackers
        if (engine.swarm && engine.swarm._trackers) {
          console.log(`📡 Re-announcing to ${engine.swarm._trackers.length} trackers...`);
          
          engine.swarm._trackers.forEach((tracker, index) => {
            if (tracker) {
              try {
                if (typeof tracker.announce === 'function') {
                  tracker.announce();
                  console.log(`  ✅ Announced to tracker ${index + 1}`);
                } else if (tracker.client && typeof tracker.client.announce === 'function') {
                  tracker.client.announce();
                  console.log(`  ✅ Announced to tracker ${index + 1} (client)`);
                }
              } catch (e) {
                console.log(`  ❌ Failed to announce to tracker ${index + 1}: ${e.message}`);
              }
            }
          });
        }
        
        // Try to bootstrap DHT if available
        if (engine.dht && typeof engine.dht.bootstrap === 'function') {
          console.log(`🌐 Bootstrapping DHT for better peer discovery...`);
          try {
            engine.dht.bootstrap();
          } catch (e) {
            console.log(`⚠️ DHT bootstrap failed: ${e.message}`);
          }
        }
        
        // Extract additional trackers from the magnet URL
        const trackerMatches = magnetUrl.match(/tr=([^&]+)/g);
        if (trackerMatches) {
          console.log(`🔗 Found ${trackerMatches.length} trackers in magnet URL`);
          trackerMatches.forEach((match, index) => {
            const trackerUrl = decodeURIComponent(match.substring(3));
            console.log(`  📡 Tracker ${index + 1}: ${trackerUrl}`);
          });
        }
        
        // Manual peer injection if we have them from other sources
        this.tryManualPeerInjection(engine, magnetUrl);
        
        setTimeout(attemptPeerDiscovery, 10000); // Try again in 10 seconds
      } else {
        console.log(`✅ Peer discovery successful! Found ${peers} peers`);
      }
    };
    
    // Start discovery after initial connection period
    setTimeout(attemptPeerDiscovery, 5000);
  }

  tryManualPeerInjection(engine, magnetUrl) {
    console.log(`🎯 Attempting manual peer injection techniques...`);
    
    // Common DHT nodes that might help bootstrap
    const dhtBootstrapNodes = [
      { host: 'router.bittorrent.com', port: 6881 },
      { host: 'dht.transmissionbt.com', port: 6881 },
      { host: 'router.utorrent.com', port: 6881 }
    ];
    
    // Try to connect to DHT bootstrap nodes
    if (engine.dht) {
      dhtBootstrapNodes.forEach(node => {
        try {
          if (typeof engine.dht.addNode === 'function') {
            engine.dht.addNode(node);
            console.log(`  🌐 Added DHT bootstrap node: ${node.host}:${node.port}`);
          }
        } catch (e) {
          console.log(`  ⚠️ Failed to add DHT node ${node.host}: ${e.message}`);
        }
      });
    }
    
    // Try to extract peer information from magnet link
    const peerMatches = magnetUrl.match(/x\.pe=([^&]+)/g);
    if (peerMatches) {
      console.log(`👥 Found ${peerMatches.length} peers in magnet URL`);
      peerMatches.forEach((match, index) => {
        try {
          const peerInfo = decodeURIComponent(match.substring(5));
          console.log(`  👤 Peer ${index + 1}: ${peerInfo}`);
          
          // Try to connect to peer if format is IP:PORT
          const peerMatch = peerInfo.match(/^(.+):(\d+)$/);
          if (peerMatch && engine.swarm) {
            const [, ip, port] = peerMatch;
            if (typeof engine.swarm.add === 'function') {
              engine.swarm.add(`${ip}:${port}`);
              console.log(`  🔗 Attempting connection to peer: ${ip}:${port}`);
            }
          }
        } catch (e) {
          console.log(`  ⚠️ Failed to process peer info: ${e.message}`);
        }
      });
    }
  }

  async performNetworkDiagnostics(magnetUrl) {
    console.log(`🔧 Performing network diagnostics for magnet URL...`);
    
    // Extract info hash
    const infoHashMatch = magnetUrl.match(/urn:btih:([a-fA-F0-9]{40})/);
    const infoHash = infoHashMatch ? infoHashMatch[1] : 'unknown';
    console.log(`🆔 Torrent Info Hash: ${infoHash}`);
    
    // Extract trackers
    const trackerMatches = magnetUrl.match(/tr=([^&]+)/g) || [];
    console.log(`📡 Trackers found in magnet URL: ${trackerMatches.length}`);
    
    trackerMatches.forEach((match, index) => {
      const trackerUrl = decodeURIComponent(match.substring(3));
      const protocol = trackerUrl.startsWith('udp://') ? 'UDP' : 
                      trackerUrl.startsWith('http://') ? 'HTTP' : 'UNKNOWN';
      console.log(`  ${index + 1}. [${protocol}] ${trackerUrl}`);
    });
    
    // Test basic network connectivity
    console.log(`🌐 Testing network connectivity...`);
    
    try {
      const dns = require('dns').promises;
      await dns.lookup('google.com');
      console.log(`  ✅ Internet connectivity: OK`);
    } catch (error) {
      console.log(`  ❌ Internet connectivity: FAILED - ${error.message}`);
    }
    
    // Check if common BitTorrent UDP ports are available
    console.log(`🔌 Checking BitTorrent UDP ports...`);
    const dgram = require('dgram');
    
    const testUdpPort = (port) => {
      return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        
        socket.bind(port, () => {
          console.log(`  Port ${port} (UDP): ✅ Available for BitTorrent`);
          socket.close();
          resolve(true);
        });
        
        socket.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`  Port ${port} (UDP): ❌ Already in use`);
          } else if (err.code === 'EACCES') {
            console.log(`  Port ${port} (UDP): ❌ Permission denied`);
          } else {
            console.log(`  Port ${port} (UDP): ❌ Error - ${err.message}`);
          }
          resolve(false);
        });
      });
    };
    
    // Test our configured ports
    const torrentPorts = [6881, 6882, 6883, 6969];
    for (const port of torrentPorts) {
      await testUdpPort(port);
    }
    
    // Check if we can reach a known UDP tracker
    console.log(`🎯 Testing UDP tracker connectivity...`);
    try {
      const testTracker = 'tracker.openbittorrent.com';
      const dns = require('dns').promises;
      const result = await dns.lookup(testTracker);
      console.log(`  ✅ Can resolve ${testTracker} -> ${result.address}`);
    } catch (error) {
      console.log(`  ❌ Cannot resolve UDP tracker: ${error.message}`);
    }
    
    // Check system environment
    console.log(`💻 System environment:`);
    console.log(`  Platform: ${process.platform}`);
    console.log(`  Architecture: ${process.arch}`);
    console.log(`  Node.js: ${process.version}`);
    
    // Network interface information
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    console.log(`🌐 Network interfaces:`);
    
    Object.keys(networkInterfaces).forEach(interfaceName => {
      const interfaces = networkInterfaces[interfaceName];
      const ipv4Interface = interfaces.find(iface => iface.family === 'IPv4' && !iface.internal);
      if (ipv4Interface) {
        console.log(`  ${interfaceName}: ${ipv4Interface.address} (${ipv4Interface.internal ? 'internal' : 'external'})`);
      }
    });
    
    console.log(`🔍 BitTorrent troubleshooting tips:`);
    console.log(`  1. Make sure UDP ports 6881-6889 are not blocked by firewall`);
    console.log(`  2. If behind NAT/router, consider port forwarding UDP 6881-6882`);
    console.log(`  3. Some ISPs throttle or block BitTorrent UDP traffic`);
    console.log(`  4. VPNs can interfere with UDP tracker communication`);
  }
}

module.exports = new TorrentService();
