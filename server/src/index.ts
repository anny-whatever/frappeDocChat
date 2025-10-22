import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { EmbeddingService } from "./services/embeddingService.ts";
import { DatabaseService } from "./services/databaseService.ts";
import { AgentService } from "./agents/agentService.ts";
import type { Message } from "./agents/agentService.ts";

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

// Test SSE endpoint
app.get("/api/test-stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  let counter = 0;
  const interval = setInterval(() => {
    counter++;
    res.write(`event: test\n`);
    res.write(`data: {"message": "Test message ${counter}"}\n\n`);
    
    if (counter >= 5) {
      res.write(`event: done\n`);
      res.write(`data: {"message": "Test completed"}\n\n`);
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// SSE-style streaming endpoint
app.post("/api/chat/stream", async (req, res) => {
  console.log("\n🌊 Starting streaming chat endpoint");
  
  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  let isClientConnected = true;

  // Handle client disconnect
  req.on("close", () => {
    console.log("🔌 Client disconnected from stream");
    isClientConnected = false;
  });

  req.on("error", (error) => {
    console.error("🚨 Request error:", error);
    isClientConnected = false;
  });

  // Connection check function
  const checkConnection = () => !isClientConnected;

  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: "Message is required" })}\n\n`);
      res.end();
      return;
    }

    console.log(`📨 Received message: "${message}"`);

    // Send initial heartbeat
    res.write(`event: heartbeat\n`);
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    // Start agent streaming
    await agentService.processMessageStream(
      message,
      conversationHistory,
      res,
      checkConnection
    );

    console.log("✅ Stream completed successfully");
    
  } catch (error) {
    console.error("🚨 Stream error:", error);
    
    if (isClientConnected) {
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error" 
      })}\n\n`);
    }
  } finally {
    if (isClientConnected) {
      res.write(`event: end\n`);
      res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      res.end();
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
