import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { EmbeddingService } from "./services/embeddingService.js";
import { DatabaseService } from "./services/databaseService.js";
import { AgentService, Message } from "./agents/agentService.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());

// Services
const embeddingService = EmbeddingService.getInstance();
const databaseService = DatabaseService.getInstance();
const agentService = AgentService.getInstance();

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Search endpoint
app.post("/api/search", async (req, res) => {
  try {
    const { query, limit = 10, threshold = 0.3 } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        error: "Query is required and must be a string",
      });
    }

    if (query.trim().length === 0) {
      return res.status(400).json({
        error: "Query cannot be empty",
      });
    }

    console.log(`Searching for: "${query}"`);

    // Generate embedding for the search query
    const queryEmbedding = await embeddingService.generateQueryEmbedding(query);

    // Search for similar documents
    const results = await databaseService.searchSimilarDocuments(
      queryEmbedding,
      parseInt(limit),
      parseFloat(threshold)
    );

    console.log(`Found ${results.length} results`);

    res.json({
      query,
      results,
      count: results.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({
      error: "Internal server error during search",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get all documents endpoint
app.get("/api/documents", async (req, res) => {
  try {
    const documents = await databaseService.getAllDocuments();

    res.json({
      documents,
      count: documents.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching documents:", error);
    res.status(500).json({
      error: "Internal server error while fetching documents",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get document by ID endpoint
app.get("/api/documents/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // This would require adding a getDocumentById method to DatabaseService
    // For now, we'll return a simple response
    res.status(501).json({
      error: "Not implemented yet",
      message: "Individual document retrieval not yet implemented",
    });
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({
      error: "Internal server error while fetching document",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Stats endpoint
app.get("/api/stats", async (req, res) => {
  try {
    const documents = await databaseService.getAllDocuments();

    res.json({
      totalDocuments: documents.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      error: "Internal server error while fetching stats",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Chat endpoint - Agentic RAG Chat
app.post("/api/chat", async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required and must be a string",
      });
    }

    if (message.trim().length === 0) {
      return res.status(400).json({
        error: "Message cannot be empty",
      });
    }

    console.log(`💬 Chat request: "${message}"`);

    // Process message through agent
    const agentResponse = await agentService.processMessage(
      message,
      conversationHistory as Message[]
    );

    res.json({
      message: agentResponse.response,
      toolCalls: agentResponse.toolCalls,
      conversationHistory: agentResponse.conversationHistory,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: "Internal server error during chat",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Chat streaming endpoint (SSE-style)
app.post("/api/chat/stream", async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== "string") {
      res
        .status(400)
        .json({ error: "Message is required and must be a string" });
      return;
    }
    if (message.trim().length === 0) {
      res.status(400).json({ error: "Message cannot be empty" });
      return;
    }

    // Set headers for server-sent events
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    // Helpful for proxies (Heroku, etc.) to flush data
    if (typeof (res as any).flushHeaders === "function") (res as any).flushHeaders();

    const writeEvent = (event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
    });

    // Process the message fully via agent, then stream chunks of the result
    const agentResponse = await agentService.processMessage(
      message,
      conversationHistory as Message[]
    );

    const finalText: string = agentResponse.response || "";
    const chunkSize = 64; // characters per chunk for smoother UI
    for (let i = 0; i < finalText.length && !clientClosed; i += chunkSize) {
      const delta = finalText.slice(i, i + chunkSize);
      writeEvent("message", { delta });
    }

    // Send tool calls metadata (if any)
    writeEvent("meta", {
      toolCalls: agentResponse.toolCalls || [],
      timestamp: new Date().toISOString(),
    });

    // Signal completion with updated conversation history
    writeEvent("done", {
      conversationHistory: agentResponse.conversationHistory,
    });

    res.end();
  } catch (error) {
    // If headers already sent (stream started), emit error event; else JSON error
    if (res.headersSent) {
      res.write(`event: error\n`);
      res.write(
        `data: ${JSON.stringify({
          error: "Internal server error during chat",
          message: error instanceof Error ? error.message : "Unknown error",
        })}\n\n`
      );
      res.end();
    } else {
      res.status(500).json({
        error: "Internal server error during chat",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
});

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  }
);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 Search API: http://localhost:${PORT}/api/search`);
  console.log(`📚 Documents API: http://localhost:${PORT}/api/documents`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");
  await databaseService.disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down server...");
  await databaseService.disconnect();
  process.exit(0);
});
