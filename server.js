import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

// --- Express + Socket.IO
const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" } // open for demo; restrict later
});

// --- Simple in-memory state
const state = {
  tick: 0,
  assets: {
    A: { price: 100.0, last: Date.now() },
    B: { price: 120.0, last: Date.now() },
    C: { price: 80.0,  last: Date.now() }
  },
  players: {}, // socketId -> { name, pnl, positions: {A:0,B:0,C:0}, cash }
  leaderboard: []
};

// --- Helpers
function snapshot() {
  return {
    tick: state.tick,
    assets: {
      A: { price: Number(state.assets.A.price.toFixed(2)) },
      B: { price: Number(state.assets.B.price.toFixed(2)) },
      C: { price: Number(state.assets.C.price.toFixed(2)) }
    },
    leaderboard: state.leaderboard
  };
}

function ensurePlayer(id) {
  if (!state.players[id]) {
    state.players[id] = {
      name: "Player",
      pnl: 0,
      cash: 0,
      positions: { A: 0, B: 0, C: 0 }
    };
  }
  return state.players[id];
}

function markToMarket(p) {
  let value = 0;
  for (const k of ["A", "B", "C"]) {
    value += p.positions[k] * state.assets[k].price;
  }
  p.pnl = p.cash + value;
}

function updateLeaderboard() {
  state.leaderboard = Object.entries(state.players)
    .map(([id, p]) => ({ id, name: p.name, pnl: Number(p.pnl.toFixed(2)) }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 10);
}

// --- Tiny drift so market moves even if no trades
setInterval(() => {
  state.tick++;
  for (const k of ["A", "B", "C"]) {
    const a = state.assets[k];
    const drift = (Math.random() - 0.5) * 0.08; // +/- 4c drift
    a.price = Math.max(0.01, a.price + drift);
    a.last = Date.now();
  }
  for (const p of Object.values(state.players)) markToMarket(p);
  updateLeaderboard();
  io.emit("market_update", snapshot());
}, 1000);

// --- Socket events
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);
  ensurePlayer(socket.id);

  socket.emit("init", snapshot());

  socket.on("set_name", (name) => {
    const p = ensurePlayer(socket.id);
    p.name = (name || "Player").toString().slice(0, 24);
    markToMarket(p);
    updateLeaderboard();
    io.emit("market_update", snapshot());
  });

  // { asset:"A"|"B"|"C", side:"buy"|"sell", qty:Number }
  socket.on("trade", ({ asset, side, qty }) => {
    const p = ensurePlayer(socket.id);
    if (!["A","B","C"].includes(asset)) return;
    const q = Math.max(1, Math.floor(qty || 1));
    const px = state.assets[asset].price;

    if (side === "buy") {
      p.positions[asset] += q;
      p.cash -= q * px;
    } else if (side === "sell") {
      p.positions[asset] -= q; // allow short for demo
      p.cash += q * px;
    }

    // small impact so trades move price a bit
    const impact = q * 0.002; // ~0.2% per 100 shares
    state.assets[asset].price = Math.max(0.01,
      state.assets[asset].price * (side === "buy" ? (1 + impact) : (1 - impact))
    );
    state.assets[asset].last = Date.now();

    markToMarket(p);
    updateLeaderboard();
    io.emit("market_update", snapshot());
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
  });
});

// Health endpoint (helpful for cloud hosts)
app.get("/health", (req,res)=>res.status(200).send("ok"));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
