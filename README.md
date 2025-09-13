# Torrent HLS Streamer

A Node.js backend service that downloads torrents from magnet URLs and streams them via HLS (HTTP Live Streaming) with real-time conversion using FFmpeg.

## Features

- 🧲 Download torrents from magnet URLs
- 🎬 Real-time video conversion to HLS format
- 📺 HTTP range request support for smooth streaming
- 🧹 Automatic cleanup of old files (20-30 minutes retention)
- 📊 Stream progress tracking and status monitoring
- 🔄 Modular architecture with separated concerns
- 🌐 Web-based frontend for easy testing and interaction

## Prerequisites

- Node.js (v16 or higher)
- FFmpeg installed on your system
- Available disk space for temporary files

## Installation

### Local Development

1. Clone the repository:
```bash
git clone <repository-url>
cd torrent-hls-streamer
```

2. Install dependencies:
```bash
npm install
```

3. Make sure FFmpeg is installed:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg

# Windows
# Download from https://ffmpeg.org/download.html
```

### Docker/Portainer Deployment

For production deployment with Portainer using Git integration, see [PORTAINER_DEPLOYMENT.md](./PORTAINER_DEPLOYMENT.md) for detailed instructions.

**Quick Portainer Deployment:**
1. Push this repository to your Git service
2. In Portainer, create a new stack
3. Select "Repository" build method
4. Use your Git repository URL
5. Set compose path: `docker-compose.yml`
6. Deploy the stack

## Usage

### Start the server

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:3000` by default.

### Web Interface

Access the web-based frontend at `http://localhost:3000` for easy testing and interaction. The frontend provides:

- Simple form to input magnet URLs
- Real-time progress tracking
- Built-in HLS video player
- Comprehensive logging and status monitoring

See [FRONTEND_GUIDE.md](./FRONTEND_GUIDE.md) for detailed frontend usage instructions.

### API Endpoints

#### Create a new stream
```bash
POST /stream
Content-Type: application/json

{
  "magnetUrl": "magnet:?xt=urn:btih:..."
}
```

Response:
```json
{
  "streamId": "uuid-here",
  "status": "initializing",
  "hlsUrl": "/stream/uuid-here",
  "statusUrl": "/stream/uuid-here/status"
}
```

#### Get stream status
```bash
GET /stream/:streamId/status
```

Response:
```json
{
  "streamId": "uuid-here",
  "status": "ready",
  "progress": 100,
  "error": null,
  "createdAt": "2025-12-09T...",
  "updatedAt": "2025-12-09T..."
}
```

#### Stream HLS content
```bash
GET /stream/:streamId
```

Returns the HLS playlist file (`.m3u8`) when the stream is ready.

#### Get HLS segments
```bash
GET /hls/:streamId/:filename
```

Serves HLS video segments (`.ts` files) with range request support.

## Stream Status Flow

1. `initializing` - Stream created, preparing to download
2. `downloading` - Torrent is downloading
3. `converting` - FFmpeg is converting to HLS
4. `ready` - Stream is available for playback
5. `error` - Something went wrong

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment mode

### Customization

You can modify the following settings in the respective service files:

- **HLS segment duration**: Change `hls_time` in `ffmpegService.js`
- **Cleanup interval**: Modify parameters in `cleanupService.js`
- **Video quality**: Adjust FFmpeg parameters in `ffmpegService.js`

## File Structure

```
├── server.js                    # Main application entry point
├── controllers/
│   └── streamController.js      # HTTP request handlers
├── services/
│   ├── torrentService.js       # Torrent download management
│   ├── ffmpegService.js        # Video conversion service
│   ├── fileService.js          # File system operations
│   ├── streamManager.js        # Stream state management
│   └── cleanupService.js       # Automatic file cleanup
└── temp/                       # Temporary files (auto-created)
    ├── streams/                # Downloaded torrent files
    └── hls/                    # HLS segments and playlists
```

## Example Usage

```bash
# Start the server
npm start

# Create a stream
curl -X POST http://localhost:3000/stream \
  -H "Content-Type: application/json" \
  -d '{"magnetUrl": "magnet:?xt=urn:btih:example..."}'

# Check stream status
curl http://localhost:3000/stream/{streamId}/status

# Once ready, access the stream
curl http://localhost:3000/stream/{streamId}
```

## Health Check

```bash
GET /health
```

Returns server health status.

## Troubleshooting

### Common Issues

1. **FFmpeg not found**: Ensure FFmpeg is installed and in your PATH
2. **Permission errors**: Check write permissions for the temp directory
3. **Port conflicts**: Change the PORT environment variable
4. **Torrent timeout**: Some torrents may take time to find peers

### Logs

The application provides detailed console logging for debugging:
- 🌊 Torrent operations
- 🎞️ FFmpeg conversion
- 📊 Stream management
- 🧹 Cleanup operations

## License

MIT License

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request
