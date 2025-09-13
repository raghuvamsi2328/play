# Frontend Testing Guide

## 🌐 Web Interface

The torrent HLS streamer now includes a web-based frontend for easy testing and interaction with the API.

### Features

- **🎨 Modern UI**: Clean, responsive design with gradient styling
- **📥 Stream Creation**: Simple form to input magnet URLs
- **📊 Real-time Status**: Live progress tracking and status updates
- **📺 Video Player**: Built-in HLS video player with broad browser support
- **📋 Logging**: Real-time logs showing all operations
- **🔗 Example Magnets**: Pre-filled example magnet URLs for testing

### Access

Once the server is running, access the frontend at:
- **Local**: http://localhost:3000
- **Docker**: http://localhost:3000 (or your configured port)

### Browser Compatibility

The frontend supports HLS playback across all modern browsers:
- **Safari/iOS**: Native HLS support
- **Chrome/Firefox/Edge**: Uses hls.js library for HLS support

### How to Use

1. **Enter Magnet URL**: Paste a magnet link in the input field
2. **Create Stream**: Click "Create Stream" to start the process
3. **Monitor Progress**: Watch real-time status and download progress
4. **Stream Video**: Once ready, the video player will appear automatically

### Testing Features

- **Health Check**: Automatic server connectivity check on page load
- **Example Magnets**: Click on example magnet URLs to populate the input
- **Progress Bar**: Visual progress indicator for download and conversion
- **Error Handling**: Clear error messages and success notifications
- **Logs**: Detailed logging of all operations and API calls

### Development

The frontend is served as static files from the `public/` directory and integrates seamlessly with the Node.js backend APIs.
