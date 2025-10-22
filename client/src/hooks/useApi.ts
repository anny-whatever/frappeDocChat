import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiService } from "../services/api";
import type {
  SearchResponse,
  DocumentsResponse,
  StatsResponse,
  HealthResponse,
  ChatRequest,
  ChatResponse,
} from "../services/api";

// Query keys
export const queryKeys = {
  health: ["health"] as const,
  documents: ["documents"] as const,
  stats: ["stats"] as const,
  search: (query: string, limit: number, threshold: number) =>
    ["search", query, limit, threshold] as const,
};

// Health check hook
export const useHealth = () => {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: apiService.checkHealth,
    staleTime: 30000000, // 30 seconds
    refetchInterval: 60000000, // 1 minute
  });
};

// Documents hook
export const useDocuments = () => {
  return useQuery({
    queryKey: queryKeys.documents,
    queryFn: apiService.getAllDocuments,
    staleTime: 30000000, // 5 minutes
  });
};

// Stats hook
export const useStats = () => {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: apiService.getStats,
    staleTime: 60000, // 1 minute
  });
};

// Search hook with manual trigger
export const useSearch = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      query,
      limit = 10,
      threshold = 0.7,
    }: {
      query: string;
      limit?: number;
      threshold?: number;
    }) => {
      return apiService.searchDocuments(query, limit, threshold);
    },
    onSuccess: (data, variables) => {
      // Cache the search result
      queryClient.setQueryData(
        queryKeys.search(
          variables.query,
          variables.limit || 10,
          variables.threshold || 0.7
        ),
        data
      );
    },
  });
};

// Search hook with automatic query (for real-time search)
export const useSearchQuery = (
  query: string,
  limit: number = 10,
  threshold: number = 0.7,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: queryKeys.search(query, limit, threshold),
    queryFn: () => apiService.searchDocuments(query, limit, threshold),
    enabled: enabled && query.trim().length > 0,
    staleTime: 30000000, // 5 minutes
    retry: 2,
  });
};

// Document by ID hook
export const useDocument = (id: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ["document", id],
    queryFn: () => apiService.getDocumentById(id),
    enabled: enabled && !!id,
    staleTime: 30000000, // 5 minutes
  });
};

// Chat hook
export const useChat = () => {
  return useMutation({
    mutationFn: async (request: ChatRequest) => {
      return apiService.chat(request);
    },
  });
};
