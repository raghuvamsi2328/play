# Torrent HLS Streamer - Portainer Git Deployment Guide

## 🚀 Deploy with Portainer using Git Repository

### Prerequisites
- Portainer CE/EE installed and running
- Git repository containing this code
- Docker environment accessible by Portainer

### Deployment Steps

#### 1. Push Code to Git Repository
```bash
git init
git add .
git commit -m "Initial commit - Torrent HLS Streamer"
git remote add origin <your-git-repo-url>
git push -u origin main
```

#### 2. Create Stack in Portainer

1. **Login to Portainer**
   - Navigate to your Portainer instance
   - Login with your credentials

2. **Create New Stack**
   - Go to `Stacks` in the left sidebar
   - Click `+ Add stack`
   - Enter stack name: `torrent-hls-streamer`

3. **Configure Git Repository**
   - Select `Repository` as the build method
   - Enter your Git repository URL
   - Set reference: `refs/heads/main` (or your main branch)
   - Set compose path: `docker-compose.yml`

4. **Environment Variables (Optional)**
   Add these environment variables if needed:
   ```
   NODE_ENV=production
   PORT=3000
   ```

5. **Advanced Options**
   - Enable auto-updates if desired
   - Set webhook for automatic redeployment

6. **Deploy Stack**
   - Click `Deploy the stack`
   - Wait for the build and deployment to complete

#### 3. Access Your Application

Once deployed, your application will be available at:
- **Local access**: `http://localhost:3000`
- **Health check**: `http://localhost:3000/health`
- **API endpoint**: `http://localhost:3000/stream`

### 🔧 Configuration Options

#### Port Configuration
If you need to change the port, update the docker-compose.yml:
```yaml
ports:
  - "8080:3000"  # External:Internal
```

#### Volume Persistence
The temp directory is mounted as a volume for persistence:
```yaml
volumes:
  - torrent_temp:/app/temp
```

#### Network Configuration
The service runs on a bridge network `torrent-network` by default.

### 📊 Monitoring

#### Health Check
The container includes a health check that runs every 30 seconds:
- Endpoint: `/health`
- Timeout: 10 seconds
- Retries: 3

#### Logs
View logs in Portainer:
1. Go to `Containers`
2. Click on `torrent-hls-streamer`
3. Click `Logs` tab

### 🔄 Updates and Redeployment

#### Manual Update
1. Push changes to your Git repository
2. In Portainer, go to your stack
3. Click `Editor` tab
4. Click `Update the stack`

#### Automatic Updates
If you enabled webhooks:
1. Configure your Git repository to send webhooks to Portainer
2. Push changes to trigger automatic redeployment

### 🛠️ Troubleshooting

#### Common Issues

1. **Build Failures**
   - Check Portainer logs for build errors
   - Ensure Dockerfile is in repository root
   - Verify all dependencies are correctly specified

2. **Port Conflicts**
   - Change the external port in docker-compose.yml
   - Ensure no other services are using port 3000

3. **Permission Issues**
   - The container runs as root to handle torrent operations
   - Temp directory permissions are set during build

4. **FFmpeg Issues**
   - FFmpeg is installed in the Alpine Linux container
   - Check container logs for FFmpeg-related errors

#### Debug Commands
Access container shell for debugging:
```bash
docker exec -it torrent-hls-streamer sh
```

Check FFmpeg installation:
```bash
docker exec torrent-hls-streamer ffmpeg -version
```

### 📈 Resource Usage

**Recommended Minimum Resources:**
- **CPU**: 1 core
- **RAM**: 512MB (1GB recommended)
- **Storage**: 2GB for temp files and segments

**Production Recommendations:**
- **CPU**: 2+ cores (for concurrent streams)
- **RAM**: 2GB+ (depends on stream count)
- **Storage**: 10GB+ (for multiple concurrent streams)

### 🔐 Security Considerations

1. **Network Security**
   - Consider using reverse proxy (Traefik/Nginx)
   - Enable HTTPS in production
   - Restrict access using firewall rules

2. **Container Security**
   - Keep base images updated
   - Monitor for security vulnerabilities
   - Use non-root user if possible (advanced setup)

### 📝 API Usage Example

Once deployed, test with:

```bash
# Create a stream
curl -X POST http://your-server:3000/stream \
  -H "Content-Type: application/json" \
  -d '{"magnetUrl": "magnet:?xt=urn:btih:..."}'

# Check status
curl http://your-server:3000/stream/{streamId}/status

# Stream URL (once ready)
http://your-server:3000/stream/{streamId}
```
