import { DatabaseService } from "./databaseService.js";
import { EmbeddingService } from "./embeddingService.js";
import { QueryDecompositionService, SubQuery } from "./queryDecompositionService.js";
import { QueryExpansionService, ExpandedQuery } from "./queryExpansionService.js";

export interface SearchResult {
  id: string;
  filename: string;
  title: string;
  content: string;
  similarity: number;
  sourceUrl?: string;
  metadata?: any;
  searchStrategy: string;
  queryUsed: string;
}

export interface MultiQueryResult {
  originalQuery: string;
  allResults: SearchResult[];
  deduplicatedResults: SearchResult[];
  searchStrategies: string[];
  totalQueries: number;
  executionTime: number;
}

export interface SearchStrategy {
  name: string;
  queries: string[];
  weight: number; // For result scoring
  threshold?: number;
  limit?: number;
}

export class MultiQueryService {
  private static instance: MultiQueryService;
  private databaseService: DatabaseService;
  private embeddingService: EmbeddingService;
  private queryDecomposition: QueryDecompositionService;
  private queryExpansion: QueryExpansionService;

  private constructor() {
    this.databaseService = DatabaseService.getInstance();
    this.embeddingService = EmbeddingService.getInstance();
    this.queryDecomposition = QueryDecompositionService.getInstance();
    this.queryExpansion = QueryExpansionService.getInstance();
  }

  static getInstance(): MultiQueryService {
    if (!MultiQueryService.instance) {
      MultiQueryService.instance = new MultiQueryService();
    }
    return MultiQueryService.instance;
  }

  /**
   * Execute a single search query
   */
  private async executeSearch(
    query: string,
    strategy: string,
    threshold: number = 0.7,
    limit: number = 10
  ): Promise<SearchResult[]> {
    try {
      const embedding = await this.embeddingService.generateQueryEmbedding(query);
      const results = await this.databaseService.searchSimilarDocuments(
        embedding,
        limit,
        threshold
      );

      return results.map(result => ({
        ...result,
        similarity: result.similarity || 0,
        searchStrategy: strategy,
        queryUsed: query
      }));
    } catch (error) {
      console.error(`Error in search strategy ${strategy}:`, error);
      return [];
    }
  }

  /**
   * Generate search strategies based on query analysis
   */
  private async generateSearchStrategies(query: string): Promise<SearchStrategy[]> {
    const strategies: SearchStrategy[] = [];

    // Strategy 1: Original query (high weight)
    strategies.push({
      name: "original",
      queries: [query],
      weight: 1.0,
      threshold: 0.75,
      limit: 8
    });

    // Strategy 2: Query decomposition
    const decomposition = await this.queryDecomposition.decomposeQuery(query);
    if (decomposition.isComplex && decomposition.subQueries.length > 1) {
      const subQueries = decomposition.subQueries
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 3)
        .map(sq => sq.question);
      
      strategies.push({
        name: "decomposed",
        queries: subQueries,
        weight: 0.9,
        threshold: 0.7,
        limit: 6
      });
    }

    // Strategy 3: Query expansion
    const expansion = await this.queryExpansion.expandQuery(query);
    if (expansion.expandedQueries.length > 0) {
      const expandedQueries = expansion.expandedQueries
        .filter(eq => eq.confidence > 0.6)
        .slice(0, 3)
        .map(eq => eq.expanded);
      
      strategies.push({
        name: "expanded",
        queries: expandedQueries,
        weight: 0.8,
        threshold: 0.65,
        limit: 6
      });
    }

    // Strategy 4: Technical context variations
    const technicalVariations = await this.queryExpansion.generateSearchVariations(
      query,
      "api"
    );
    if (technicalVariations.length > 1) {
      strategies.push({
        name: "technical",
        queries: technicalVariations.slice(0, 2),
        weight: 0.7,
        threshold: 0.6,
        limit: 5
      });
    }

    // Strategy 5: Troubleshooting context (if query seems like a problem)
    if (this.isTroubleshootingQuery(query)) {
      const troubleshootingVariations = await this.queryExpansion.generateSearchVariations(
        query,
        "troubleshooting"
      );
      strategies.push({
        name: "troubleshooting",
        queries: troubleshootingVariations.slice(0, 2),
        weight: 0.85,
        threshold: 0.65,
        limit: 5
      });
    }

    return strategies;
  }

  /**
   * Check if query is troubleshooting-related
   */
  private isTroubleshootingQuery(query: string): boolean {
    const troubleshootingKeywords = [
      "error", "problem", "issue", "not working", "failed", "fix", "solve",
      "troubleshoot", "debug", "broken", "wrong", "help", "can't", "unable"
    ];
    
    const queryLower = query.toLowerCase();
    return troubleshootingKeywords.some(keyword => queryLower.includes(keyword));
  }

  /**
   * Deduplicate results based on content similarity and filename
   */
  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    const deduplicated: SearchResult[] = [];
    
    // Sort by similarity score first
    const sorted = results.sort((a, b) => b.similarity - a.similarity);
    
    for (const result of sorted) {
      // Create a key based on filename and first 100 characters of content
      const key = `${result.filename}_${result.content.substring(0, 100)}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(result);
      } else {
        // If we've seen this content, but current result has higher similarity,
        // replace the previous one
        const existingIndex = deduplicated.findIndex(r => 
          `${r.filename}_${r.content.substring(0, 100)}` === key
        );
        if (existingIndex !== -1 && result.similarity > deduplicated[existingIndex].similarity) {
          deduplicated[existingIndex] = result;
        }
      }
    }
    
    return deduplicated;
  }

  /**
   * Score and rank results based on multiple factors
   */
  private scoreResults(results: SearchResult[], strategies: SearchStrategy[]): SearchResult[] {
    return results.map(result => {
      const strategy = strategies.find(s => s.name === result.searchStrategy);
      const strategyWeight = strategy?.weight || 0.5;
      
      // Calculate composite score
      const compositeScore = result.similarity * strategyWeight;
      
      return {
        ...result,
        similarity: compositeScore
      };
    }).sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Execute multi-query search with various strategies
   */
  async executeMultiQuery(
    query: string,
    maxResults: number = 15
  ): Promise<MultiQueryResult> {
    const startTime = Date.now();
    
    try {
      // Generate search strategies
      const strategies = await this.generateSearchStrategies(query);
      
      // Execute all searches in parallel
      const searchPromises: Promise<SearchResult[]>[] = [];
      let totalQueries = 0;
      
      for (const strategy of strategies) {
        for (const strategyQuery of strategy.queries) {
          totalQueries++;
          searchPromises.push(
            this.executeSearch(
              strategyQuery,
              strategy.name,
              strategy.threshold,
              strategy.limit
            )
          );
        }
      }
      
      // Wait for all searches to complete
      const allSearchResults = await Promise.all(searchPromises);
      const flatResults = allSearchResults.flat();
      
      // Score results based on strategy weights
      const scoredResults = this.scoreResults(flatResults, strategies);
      
      // Deduplicate results
      const deduplicatedResults = this.deduplicateResults(scoredResults);
      
      // Limit final results
      const finalResults = deduplicatedResults.slice(0, maxResults);
      
      const executionTime = Date.now() - startTime;
      
      return {
        originalQuery: query,
        allResults: flatResults,
        deduplicatedResults: finalResults,
        searchStrategies: strategies.map(s => s.name),
        totalQueries,
        executionTime
      };
    } catch (error) {
      console.error("Error in multi-query execution:", error);
      
      // Fallback to simple search
      const fallbackResults = await this.executeSearch(query, "fallback");
      
      return {
        originalQuery: query,
        allResults: fallbackResults,
        deduplicatedResults: fallbackResults,
        searchStrategies: ["fallback"],
        totalQueries: 1,
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Execute iterative search with follow-up queries
   */
  async executeIterativeSearch(
    query: string,
    maxIterations: number = 2,
    maxResults: number = 15
  ): Promise<MultiQueryResult> {
    let currentResults: SearchResult[] = [];
    let allResults: SearchResult[] = [];
    let totalQueries = 0;
    const startTime = Date.now();
    const strategiesUsed: string[] = [];
    
    // First iteration: Multi-query search
    const initialSearch = await this.executeMultiQuery(query, Math.floor(maxResults * 0.7));
    currentResults = initialSearch.deduplicatedResults;
    allResults = [...initialSearch.allResults];
    totalQueries += initialSearch.totalQueries;
    strategiesUsed.push(...initialSearch.searchStrategies);
    
    // Additional iterations: Follow-up queries based on results
    for (let i = 1; i < maxIterations && currentResults.length > 0; i++) {
      const followUpQueries = await this.queryDecomposition.generateFollowUpQueries(
        query,
        currentResults.slice(0, 3)
      );
      
      if (followUpQueries.length === 0) break;
      
      const followUpPromises = followUpQueries.map(fq => 
        this.executeSearch(fq.question, `followup_${i}`, 0.65, 5)
      );
      
      const followUpResults = await Promise.all(followUpPromises);
      const newResults = followUpResults.flat();
      
      allResults.push(...newResults);
      totalQueries += followUpQueries.length;
      strategiesUsed.push(`followup_${i}`);
      
      // Update current results for next iteration
      currentResults = newResults;
    }
    
    // Final deduplication and scoring
    const finalDeduplicatedResults = this.deduplicateResults(allResults)
      .slice(0, maxResults);
    
    return {
      originalQuery: query,
      allResults,
      deduplicatedResults: finalDeduplicatedResults,
      searchStrategies: [...new Set(strategiesUsed)],
      totalQueries,
      executionTime: Date.now() - startTime
    };
  }
}