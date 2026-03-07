// server.js  (or index.js)
// Recommended structure for 2025-era small project

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Very permissive CORS for localhost development
// In production → change to your actual frontend domain
const io = new Server(server, {
  cors: {
    origin: "https://main.d1qvyg0l26z205.amplifyapp.com",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ────────────────────────────────────────────────
//   In-memory waiting queue (very simple version)
// ────────────────────────────────────────────────
const waitingUsers = new Map();       // socket.id → socket
const activePairs = new Map();        // socket.id → peerSocket.id

// Optional: you can later store userId/email instead of socket.id
// const waitingUsers = new Map();    // userId → socket

// ────────────────────────────────────────────────
//   Matching logic
// ────────────────────────────────────────────────
function tryMatchWaitingUser(newSocket) {
  if (waitingUsers.size === 0) {
    // First person → just wait
    waitingUsers.set(newSocket.id, newSocket);
    newSocket.emit('waiting');
    return;
  }

  // Take the oldest waiting user
  const [peerId, peerSocket] = waitingUsers.entries().next().value;
  waitingUsers.delete(peerId);

  // Pair them
  activePairs.set(newSocket.id, peerId);
  activePairs.set(peerId, newSocket.id);

  // Notify both
  newSocket.emit('peer-matched', { peerId, role: 'caller' });
  peerSocket.emit('peer-matched', { peerId: newSocket.id, role: 'callee' });

  console.log(`Matched ${peerId} ↔ ${newSocket.id}`);
}

// ────────────────────────────────────────────────
//   Socket connection handling
// ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // ─── User wants to join random hangout ───
  socket.on('join-queue', () => {
    tryMatchWaitingUser(socket);
  });

  // ─── WebRTC signaling ───
  socket.on('offer', ({ to, offer }) => {
    const target = io.sockets.sockets.get(to);
    if (target) target.emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    const target = io.sockets.sockets.get(to);
    if (target) target.emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const target = io.sockets.sockets.get(to);
    if (target) target.emit('ice-candidate', { candidate });
  });

  // ─── Hang up / disconnect cleanly ───
  socket.on('hangup', ({ to }) => {
    const peerId = activePairs.get(socket.id);
    if (peerId && peerId === to) {
      const peerSocket = io.sockets.sockets.get(peerId);
      if (peerSocket) {
        peerSocket.emit('hangup');
      }
      activePairs.delete(socket.id);
      activePairs.delete(peerId);
    }
  });

  // ─── When user disconnects ───
  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id} (${reason})`);

    // Was waiting → remove from queue
    if (waitingUsers.has(socket.id)) {
      waitingUsers.delete(socket.id);
    }

    // Was in call → notify peer
    const peerId = activePairs.get(socket.id);
    if (peerId) {
      const peerSocket = io.sockets.sockets.get(peerId);
      if (peerSocket) {
        peerSocket.emit('hangup');
      }
      activePairs.delete(socket.id);
      activePairs.delete(peerId);
    }
  });
});

// Optional: health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    waiting: waitingUsers.size,
    activePairs: activePairs.size / 2 | 0,
    connections: io.engine.clientsCount
  });
});

// Start server
const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
  console.log(`Frontend should connect to: http://localhost:${PORT}`);

});
