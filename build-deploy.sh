#!/bin/bash

# Git deployment preparation script for Portainer

echo "🚀 Preparing Torrent HLS Streamer for Portainer Git deployment..."

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "📦 Initializing Git repository..."
    git init
fi

# Add all files to git
echo "📁 Adding files to Git..."
git add .

# Check if there are changes to commit
if git diff --cached --quiet; then
    echo "ℹ️ No changes to commit"
else
    echo "💾 Committing changes..."
    git commit -m "Update: $(date '+%Y-%m-%d %H:%M:%S')"
fi

# Test Docker build locally (optional)
echo "🧪 Testing Docker build locally..."
docker build -t torrent-hls-streamer:test .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed!"
    echo "Fix the issues before pushing to Git repository"
    exit 1
fi

echo "✅ Docker build test passed!"

# Clean up test image
docker rmi torrent-hls-streamer:test > /dev/null 2>&1

echo "🏁 Ready for Portainer Git deployment!"
echo ""
echo "📋 Next steps:"
echo "1. Push to your Git repository:"
echo "   git remote add origin <your-repo-url>"
echo "   git push -u origin main"
echo ""
echo "2. In Portainer:"
echo "   - Create new stack"
echo "   - Select 'Repository' build method"
echo "   - Enter your Git repository URL"
echo "   - Set compose path: docker-compose.yml"
echo "   - Deploy the stack"
echo ""
echo "3. Access your app at: http://localhost:3000"
echo "   Health check: http://localhost:3000/health"
