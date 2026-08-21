import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import "./config/env.js";
import db from "./config/db.js";
import eventRoutes from "./routes/eventRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import trainingRoutes from "./routes/trainingRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import clothingRoutes from "./routes/clothingRoutes.js";
import transportationRoutes from "./routes/transportationRoutes.js";
import hostRoutes from "./routes/hostRoutes.js";
import chatbotRoutes from "./routes/chatbotRoutes.js";
import chatHistoryRoutes from "./routes/chatHistoryRoutes.js";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// For dress images 
app.use("/pics", express.static(path.join(__dirname, "pics")));

// Test route
app.get("/", (req, res) => {
  res.json({ message: "Gatherly API is running" });
});

// Health check - test database connection
app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (error) {
    res.status(500).json({ status: "error", database: "disconnected" });
  }
});

app.use("/api/events",eventRoutes);
app.use("/api/applications",applicationRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admins", adminRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/trainings", trainingRoutes);
app.use("/api", reviewRoutes);
app.use("/api/clothing", clothingRoutes);
app.use("/api/transportation", transportationRoutes);
app.use("/api/hosts", hostRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/chatbot", chatHistoryRoutes);

// Start server
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 5050;
const MAX_PORT_SEARCH = 20;
const startServer = (port, attemptsLeft) => {
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  server.on("error", (error) => {
    if (
      ["EADDRINUSE", "EACCES", "EPERM"].includes(error.code) &&
      attemptsLeft > 0
    ) {
      const nextPort = port + 1;
      console.warn(
        `Port ${port} is not available (${error.code}). Trying ${nextPort}...`
      );
      server.close(() => startServer(nextPort, attemptsLeft - 1));
    } else {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  });
};

startServer(DEFAULT_PORT, MAX_PORT_SEARCH);
