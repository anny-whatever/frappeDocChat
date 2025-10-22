import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { EmbeddingService } from "./services/embeddingService.js";
import { DatabaseService } from "./services/databaseService.js";
import { AgentService } from "./services/agentService.js";
import { ConversationService } from "./services/conversationService.js";

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
const conversationService = ConversationService.getInstance();

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
    const { message, conversationId } = req.body;

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
    const agentResponse = await agentService.processMessage({
      message,
      conversationId,
      userId: "default", // Use default userId since we don't have user-based implementation
    });

    res.json({
      message: agentResponse.response,
      conversationId: agentResponse.conversationId,
      sources: agentResponse.sources,
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




// Conversation management endpoints

// Get all conversations for a user
app.get("/api/conversations", async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const conversations = await conversationService.getConversations(
      undefined, // No userId filtering - fetch all conversations
      parseInt(limit as string)
    );

    res.json({
      conversations,
      count: conversations.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({
      error: "Internal server error while fetching conversations",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get a specific conversation with messages
app.get("/api/conversations/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await conversationService.getConversation(id);

    if (!conversation) {
      return res.status(404).json({
        error: "Conversation not found",
      });
    }

    res.json({
      conversation,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({
      error: "Internal server error while fetching conversation",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Create a new conversation
app.post("/api/conversations", async (req, res) => {
  try {
    const { title, metadata } = req.body;

    const conversation = await conversationService.createConversation({
      title,
      userId: "default", // Use default userId since we don't have user-based implementation
      metadata,
    });

    res.status(201).json({
      conversation,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error creating conversation:", error);
    res.status(500).json({
      error: "Internal server error while creating conversation",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Update conversation title
app.patch("/api/conversations/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!title || typeof title !== "string") {
      return res.status(400).json({
        error: "Title is required and must be a string",
      });
    }

    const updatedConversation = await conversationService.updateConversationTitle(id, title);

    res.json({
      conversation: updatedConversation,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error updating conversation:", error);
    res.status(500).json({
      error: "Internal server error while updating conversation",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Delete a conversation
app.delete("/api/conversations/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await conversationService.deleteConversation(id);

    res.json({
      message: "Conversation deleted successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    res.status(500).json({
      error: "Internal server error while deleting conversation",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Get conversation history (messages only)
app.get("/api/conversations/:id/history", async (req, res) => {
  try {
    const { id } = req.params;

    const history = await conversationService.getConversationHistory(id);

    res.json({
      history,
      count: history.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching conversation history:", error);
    res.status(500).json({
      error: "Internal server error while fetching conversation history",
      message: error instanceof Error ? error.message : "Unknown error",
    });
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
