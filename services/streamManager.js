class StreamManager {
  constructor() {
    this.streams = new Map();
  }

  createStream(streamId, magnetUrl) {
    const stream = {
      id: streamId,
      magnetUrl,
      status: 'initializing', // initializing, downloading, converting, ready, error
      progress: 0,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      accessCount: 0,
      lastAccessed: new Date()
    };

    this.streams.set(streamId, stream);
    console.log(`📊 Created stream ${streamId} at ${stream.createdAt.toISOString()}`);
    
    return stream;
  }

  getStream(streamId) {
    return this.streams.get(streamId);
  }

  getAllStreams() {
    return Array.from(this.streams.values());
  }

  updateStreamStatus(streamId, status, error = null) {
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.status = status;
      stream.error = error;
      stream.updatedAt = new Date();
      
      console.log(`📊 Stream ${streamId} status updated to: ${status}${error ? ` (${error})` : ''}`);
    }
  }

  updateStreamProgress(streamId, progress) {
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.progress = Math.max(0, Math.min(100, progress)); // Ensure 0-100 range
      stream.updatedAt = new Date();
      
      // Only log every 10% to avoid spam
      if (progress % 10 === 0) {
        console.log(`📊 Stream ${streamId} progress: ${progress}%`);
      }
    }
  }

  removeStream(streamId) {
    const removed = this.streams.delete(streamId);
    if (removed) {
      console.log(`📊 Removed stream ${streamId} from manager`);
    }
    return removed;
  }

  getStreamsByStatus(status) {
    return Array.from(this.streams.values()).filter(stream => stream.status === status);
  }

  getOldStreams(maxAgeMinutes = 30) {
    const now = new Date();
    const maxAge = maxAgeMinutes * 60 * 1000; // Convert to milliseconds

    return Array.from(this.streams.values()).filter(stream => {
      const age = now - stream.updatedAt;
      const isOld = age > maxAge;
      
      // Don't consider streams as "old" if they're still actively downloading or converting
      const isActive = ['downloading', 'converting'].includes(stream.status);
      
      // Only return streams that are old AND not actively working
      return isOld && !isActive;
    });
  }

  cleanupOldStreams(maxAgeMinutes = 30) {
    const oldStreams = this.getOldStreams(maxAgeMinutes);
    
    oldStreams.forEach(stream => {
      console.log(`🧹 Cleaning up old stream ${stream.id} (age: ${Math.round((new Date() - stream.updatedAt) / (60 * 1000))} minutes)`);
      this.removeStream(stream.id);
    });

    return oldStreams.length;
  }

  getStats() {
    const totalStreams = this.streams.size;
    const statusCounts = {};
    
    // Count streams by status
    for (const stream of this.streams.values()) {
      statusCounts[stream.status] = (statusCounts[stream.status] || 0) + 1;
    }

    return {
      totalStreams,
      statusCounts,
      streams: Array.from(this.streams.values()).map(stream => ({
        id: stream.id,
        status: stream.status,
        progress: stream.progress,
        createdAt: stream.createdAt,
        updatedAt: stream.updatedAt
      }))
    };
  }

  streamExists(streamId) {
    return this.streams.has(streamId);
  }

  getStreamWithFallback(streamId) {
    const stream = this.streams.get(streamId);
    if (!stream) {
      console.log(`⚠️ Stream ${streamId} not found in manager. Current streams: ${Array.from(this.streams.keys()).join(', ')}`);
      return null;
    }
    return stream;
  }

  // Keep streams alive by updating their timestamp
  keepStreamAlive(streamId) {
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.updatedAt = new Date();
      stream.lastAccessed = new Date();
      stream.accessCount = (stream.accessCount || 0) + 1;
      console.log(`❤️ Keeping stream ${streamId} alive (accessed ${stream.accessCount} times, last: ${stream.lastAccessed.toISOString()})`);
      return true;
    }
    return false;
  }
}

module.exports = new StreamManager();
