// server.js  (or index.js)
// Updated for troubleshooting: /health now returns plain text "working"
// This makes direct testing[](http://YOUR-EC2-DNS:5001/health) super obvious

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
    origin: "https://main.d32y54vxirgete.amplifyapp.com", // your React frontend
    methods: ["GET","POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// ────────────────────────────────────────────────
//   In-memory waiting queue (very simple version)
// ────────────────────────────────────────────────
const waitingUsers = new Map();       // socket.id → socket
const activePairs = new Map();        // socket.id → peerSocket.id

// ────────────────────────────────────────────────
//   Matching logic
// ────────────────────────────────────────────────
function tryMatchWaitingUser(newSocket) {
  if (waitingUsers.size === 0) {
    waitingUsers.set(newSocket.id, newSocket);
    newSocket.emit('waiting');
    return;
  }

  const [peerId, peerSocket] = waitingUsers.entries().next().value;
  waitingUsers.delete(peerId);

  activePairs.set(newSocket.id, peerId);
  activePairs.set(peerId, newSocket.id);

  newSocket.emit('peer-matched', { peerId, role: 'caller' });
  peerSocket.emit('peer-matched', { peerId: newSocket.id, role: 'callee' });

  console.log(`Matched ${peerId} ↔ ${newSocket.id}`);
}

// ────────────────────────────────────────────────
//   Socket connection handling
// ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-queue', () => {
    tryMatchWaitingUser(socket);
  });

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

  socket.on('hangup', ({ to }) => {
    const peerId = activePairs.get(socket.id);
    if (peerId && peerId === to) {
      const peerSocket = io.sockets.sockets.get(peerId);
      if (peerSocket) peerSocket.emit('hangup');
      activePairs.delete(socket.id);
      activePairs.delete(peerId);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`User disconnected: ${socket.id} (${reason})`);

    if (waitingUsers.has(socket.id)) {
      waitingUsers.delete(socket.id);
    }

    const peerId = activePairs.get(socket.id);
    if (peerId) {
      const peerSocket = io.sockets.sockets.get(peerId);
      if (peerSocket) peerSocket.emit('hangup');
      activePairs.delete(socket.id);
      activePairs.delete(peerId);
    }
  });
});

// UPDATED HEALTH ENDPOINT — now returns plain text "working"
// This is exactly what you asked for → when you open the URL it will say "working"
app.get('/health', (req, res) => {
  res.send('working');   // ← This is the only change
});

// (Optional) You can still get full stats at /health-json if you want
app.get('/health-json', (req, res) => {
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
  console.log(`✅ Socket.IO server running on port ${PORT}`);
  console.log(`✅ Test it now: http://localhost:${PORT}/health`);
  console.log(`✅ In production it should return: "working"`);
});
