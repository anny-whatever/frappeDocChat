import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 3000000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor for logging
api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error("API Request Error:", error);
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    console.log(`API Response: ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error("API Response Error:", error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export interface SearchResult {
  id: string;
  filename: string;
  title: string;
  content: string;
  similarity: number;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  sourceUrl?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  count: number;
  timestamp: string;
}

export interface Document {
  id: string;
  filename: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  sourceUrl?: string;
}

export interface DocumentsResponse {
  documents: Document[];
  count: number;
  timestamp: string;
}

export interface StatsResponse {
  totalDocuments: number;
  timestamp: string;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | null;
  name?: string;
  toolCalls?: any[];
  toolCallId?: string;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  userId?: string;
}

export interface ChatResponse {
  message: string;
  conversationId: string;
  sources?: Array<{
    id: string;
    title: string;
    content: string;
    similarity: number;
    sourceUrl?: string;
  }>;
  timestamp: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}

export interface ConversationData {
  userId?: string;
  title: string;
}

export interface MessageData {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export const apiService = {
  // Health check
  async checkHealth(): Promise<HealthResponse> {
    const response = await api.get<HealthResponse>("/health");
    return response.data;
  },

  // Search documents
  async searchDocuments(
    query: string,
    limit: number = 10,
    threshold: number = 0.3
  ): Promise<SearchResponse> {
    const response = await api.post<SearchResponse>("/api/search", {
      query,
      limit,
      threshold,
    });
    return response.data;
  },

  // Get all documents
  async getAllDocuments(): Promise<DocumentsResponse> {
    const response = await api.get<DocumentsResponse>("/api/documents");
    return response.data;
  },

  // Get document by ID
  async getDocumentById(id: string): Promise<Document> {
    const response = await api.get<Document>(`/api/documents/${id}`);
    return response.data;
  },

  // Get stats
  async getStats(): Promise<StatsResponse> {
    const response = await api.get<StatsResponse>("/api/stats");
    return response.data;
  },

  // Chat with agent
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await api.post<ChatResponse>("/api/chat", request);
    return response.data;
  },

  // Conversation management
  async getConversations(): Promise<Conversation[]> {
    const response = await api.get<{
      conversations: Conversation[];
      count: number;
      timestamp: string;
    }>(`/api/conversations`);
    return response.data.conversations;
  },

  async getConversation(
    conversationId: string
  ): Promise<ConversationWithMessages> {
    const response = await api.get<{
      conversation: ConversationWithMessages;
      timestamp: string;
    }>(`/api/conversations/${conversationId}`);
    return response.data.conversation;
  },

  async createConversation(data: ConversationData): Promise<Conversation> {
    const response = await api.post<{
      conversation: Conversation;
      timestamp: string;
    }>("/api/conversations", data);
    return response.data.conversation;
  },

  async updateConversation(
    conversationId: string,
    data: { title: string }
  ): Promise<Conversation> {
    const response = await api.patch<{
      conversation: Conversation;
      timestamp: string;
    }>(`/api/conversations/${conversationId}`, data);
    return response.data.conversation;
  },

  async deleteConversation(conversationId: string): Promise<void> {
    await api.delete(`/api/conversations/${conversationId}`);
  },

  async getConversationHistory(conversationId: string): Promise<Message[]> {
    const response = await api.get<{
      history: Message[];
      count: number;
      timestamp: string;
    }>(`/api/conversations/${conversationId}/history`);
    return response.data.history;
  },

  // Chat streaming (SSE over fetch)
};

export default apiService;
