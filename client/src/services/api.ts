import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
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
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ChatRequest {
  message: string;
  conversationHistory?: Message[];
}

export interface ChatResponse {
  message: string;
  toolCalls: any[];
  conversationHistory: Message[];
  timestamp: string;
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

  // Chat streaming (SSE over fetch)
  chatStream(
    request: ChatRequest,
    handlers: {
      onDelta?: (delta: string) => void;
      onMeta?: (meta: { toolCalls?: any[]; timestamp?: string; iterations?: number }) => void;
      onDone?: (payload: { conversationHistory: Message[]; finalResponse?: string }) => void;
      onError?: (err: Error) => void;
      onStatus?: (status: { message: string }) => void;
      onToolStart?: (tool: { toolName: string; toolId: string }) => void;
      onToolResult?: (result: { toolName: string; toolId: string; success: boolean; error?: string }) => void;
      onWarning?: (warning: { message: string }) => void;
    }
  ): { abort: () => void } {
    const controller = new AbortController();
    const url = `${API_BASE_URL}/api/chat/stream`;

    (async () => {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          throw new Error(`Stream HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processBuffer = () => {
          // Parse text/event-stream framing
          const parts = buffer.split("\n\n");
          // keep last incomplete part in buffer
          buffer = parts.pop() || "";
          for (const part of parts) {
            if (part.trim() === "" || part.startsWith(":")) {
              // Skip empty parts and comments (heartbeat)
              continue;
            }
            
            const lines = part.split("\n");
            let event: string | null = null;
            let data: string | null = null;
            for (const line of lines) {
              if (line.startsWith("event:")) {
                event = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                data = line.slice(5).trim();
              }
            }
            if (!event || data == null) continue;
            
            try {
              const parsed = JSON.parse(data);
              console.log("Stream event:", event, "data:", parsed);
              
              switch (event) {
                case "delta":
                  handlers.onDelta?.(parsed.delta || "");
                  break;
                case "status":
                  handlers.onStatus?.(parsed);
                  break;
                case "tool_start":
                  handlers.onToolStart?.(parsed);
                  break;
                case "tool_result":
                  handlers.onToolResult?.(parsed);
                  break;
                case "warning":
                  handlers.onWarning?.(parsed);
                  break;
                case "meta":
                  handlers.onMeta?.(parsed);
                  break;
                case "done":
                  handlers.onDone?.(parsed);
                  break;
                case "error":
                  handlers.onError?.(new Error(parsed.error || "Stream error"));
                  break;
                default:
                  console.log("Unknown stream event:", event, parsed);
              }
            } catch (e) {
              console.error("Stream parse error:", e, "data:", data);
              // swallow parse errors, but surface via onError if desired
            }
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }

        // flush any remaining buffered data
        if (buffer.length > 0) {
          processBuffer();
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log("Stream aborted by user");
        } else {
          handlers.onError?.(err as Error);
        }
      }
    })();

    return {
      abort: () => controller.abort(),
    };
  },
};

export default apiService;
