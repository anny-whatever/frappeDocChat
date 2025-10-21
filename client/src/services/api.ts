import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging
api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('API Request Error:', error);
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
    console.error('API Response Error:', error.response?.data || error.message);
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

export const apiService = {
  // Health check
  async checkHealth(): Promise<HealthResponse> {
    const response = await api.get<HealthResponse>('/health');
    return response.data;
  },

  // Search documents
  async searchDocuments(
    query: string,
    limit: number = 10,
    threshold: number = 0.3
  ): Promise<SearchResponse> {
    const response = await api.post<SearchResponse>('/api/search', {
      query,
      limit,
      threshold,
    });
    return response.data;
  },

  // Get all documents
  async getAllDocuments(): Promise<DocumentsResponse> {
    const response = await api.get<DocumentsResponse>('/api/documents');
    return response.data;
  },

  // Get document by ID
  async getDocumentById(id: string): Promise<Document> {
    const response = await api.get<Document>(`/api/documents/${id}`);
    return response.data;
  },

  // Get stats
  async getStats(): Promise<StatsResponse> {
    const response = await api.get<StatsResponse>('/api/stats');
    return response.data;
  },
};

export default apiService;