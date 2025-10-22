import { SearchResult } from "./multiQueryService.js";

export interface RankingFactors {
  semanticSimilarity: number;
  titleRelevance: number;
  contentQuality: number;
  documentType: number;
  recency: number;
  sourceReliability: number;
  queryAlignment: number;
}

export interface RankedResult extends SearchResult {
  rankingScore: number;
  rankingFactors: RankingFactors;
  originalRank: number;
}

export interface RankingConfig {
  weights: {
    semanticSimilarity: number;
    titleRelevance: number;
    contentQuality: number;
    documentType: number;
    recency: number;
    sourceReliability: number;
    queryAlignment: number;
  };
  boosts: {
    officialDocs: number;
    tutorials: number;
    apiDocs: number;
    examples: number;
  };
}

export class ResultRankingService {
  private static instance: ResultRankingService;
  
  private defaultConfig: RankingConfig = {
    weights: {
      semanticSimilarity: 0.35,
      titleRelevance: 0.20,
      contentQuality: 0.15,
      documentType: 0.10,
      recency: 0.05,
      sourceReliability: 0.10,
      queryAlignment: 0.05
    },
    boosts: {
      officialDocs: 1.2,
      tutorials: 1.1,
      apiDocs: 1.15,
      examples: 1.05
    }
  };

  private constructor() {}

  static getInstance(): ResultRankingService {
    if (!ResultRankingService.instance) {
      ResultRankingService.instance = new ResultRankingService();
    }
    return ResultRankingService.instance;
  }

  /**
   * Calculate title relevance score
   */
  private calculateTitleRelevance(title: string, query: string): number {
    const titleLower = title.toLowerCase();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    
    let score = 0;
    let totalWords = queryWords.length;
    
    // Exact phrase match in title
    if (titleLower.includes(queryLower)) {
      score += 0.8;
    }
    
    // Individual word matches
    let wordMatches = 0;
    for (const word of queryWords) {
      if (word.length > 2 && titleLower.includes(word)) {
        wordMatches++;
      }
    }
    
    score += (wordMatches / totalWords) * 0.6;
    
    // Title length penalty (very long titles are less focused)
    const lengthPenalty = Math.max(0, 1 - (title.length - 50) / 200);
    score *= lengthPenalty;
    
    return Math.min(1, score);
  }

  /**
   * Calculate content quality score
   */
  private calculateContentQuality(content: string): number {
    let score = 0.5; // Base score
    
    // Length factor (not too short, not too long)
    const length = content.length;
    if (length > 100 && length < 2000) {
      score += 0.2;
    } else if (length >= 2000 && length < 5000) {
      score += 0.1;
    }
    
    // Code examples boost
    const codePatterns = [
      /```[\s\S]*?```/g,
      /`[^`]+`/g,
      /def\s+\w+\(/g,
      /class\s+\w+/g,
      /function\s+\w+/g
    ];
    
    let codeScore = 0;
    for (const pattern of codePatterns) {
      const matches = content.match(pattern);
      if (matches) {
        codeScore += Math.min(0.1, matches.length * 0.02);
      }
    }
    score += codeScore;
    
    // Structure indicators
    const structurePatterns = [
      /^#+\s/gm, // Headers
      /^\s*[-*+]\s/gm, // Lists
      /^\s*\d+\.\s/gm, // Numbered lists
      /\n\s*\n/g // Paragraphs
    ];
    
    let structureScore = 0;
    for (const pattern of structurePatterns) {
      const matches = content.match(pattern);
      if (matches) {
        structureScore += Math.min(0.05, matches.length * 0.01);
      }
    }
    score += structureScore;
    
    return Math.min(1, score);
  }

  /**
   * Calculate document type score based on filename and content
   */
  private calculateDocumentType(filename: string, content: string): number {
    const filename_lower = filename.toLowerCase();
    const content_lower = content.toLowerCase();
    
    // API documentation
    if (filename_lower.includes('api') || content_lower.includes('api')) {
      return 0.9;
    }
    
    // Tutorials
    if (filename_lower.includes('tutorial') || 
        content_lower.includes('step') || 
        content_lower.includes('how to')) {
      return 0.85;
    }
    
    // Examples
    if (filename_lower.includes('example') || 
        content_lower.includes('example')) {
      return 0.8;
    }
    
    // Configuration/setup
    if (filename_lower.includes('config') || 
        filename_lower.includes('setup') ||
        content_lower.includes('configuration')) {
      return 0.75;
    }
    
    // Reference documentation
    if (filename_lower.includes('reference') || 
        filename_lower.includes('docs')) {
      return 0.7;
    }
    
    return 0.6; // Default score
  }

  /**
   * Calculate recency score (if metadata available)
   */
  private calculateRecency(metadata: any): number {
    if (!metadata?.processedAt) {
      return 0.5; // Default for unknown dates
    }
    
    try {
      const processedDate = new Date(metadata.processedAt);
      const now = new Date();
      const daysDiff = (now.getTime() - processedDate.getTime()) / (1000 * 60 * 60 * 24);
      
      // Newer is better, but with diminishing returns
      if (daysDiff < 30) return 1.0;
      if (daysDiff < 90) return 0.9;
      if (daysDiff < 180) return 0.8;
      if (daysDiff < 365) return 0.7;
      return 0.6;
    } catch {
      return 0.5;
    }
  }

  /**
   * Calculate source reliability score
   */
  private calculateSourceReliability(sourceUrl?: string, filename?: string): number {
    if (!sourceUrl && !filename) return 0.5;
    
    const source = (sourceUrl || filename || '').toLowerCase();
    
    // Official Frappe documentation
    if (source.includes('frappeframework.com') || 
        source.includes('frappe.io')) {
      return 1.0;
    }
    
    // Framework user documentation
    if (source.includes('framework_user')) {
      return 0.95;
    }
    
    // API documentation
    if (source.includes('api')) {
      return 0.9;
    }
    
    // Tutorial content
    if (source.includes('tutorial')) {
      return 0.85;
    }
    
    return 0.7; // Default for other sources
  }

  /**
   * Calculate query alignment score
   */
  private calculateQueryAlignment(result: SearchResult, originalQuery: string): number {
    const queryUsed = result.queryUsed.toLowerCase();
    const originalLower = originalQuery.toLowerCase();
    
    // Exact match with original query
    if (queryUsed === originalLower) {
      return 1.0;
    }
    
    // High similarity with original
    const similarity = this.calculateStringSimilarity(queryUsed, originalLower);
    if (similarity > 0.8) {
      return 0.9;
    }
    
    // Strategy-based scoring
    switch (result.searchStrategy) {
      case 'original':
        return 1.0;
      case 'decomposed':
        return 0.85;
      case 'expanded':
        return 0.8;
      case 'technical':
        return 0.75;
      case 'troubleshooting':
        return 0.9; // High for problem-solving queries
      default:
        return 0.7;
    }
  }

  /**
   * Simple string similarity calculation
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);
    
    const commonWords = words1.filter(word => 
      words2.some(w => w.includes(word) || word.includes(w))
    );
    
    return commonWords.length / Math.max(words1.length, words2.length);
  }

  /**
   * Calculate all ranking factors for a result
   */
  private calculateRankingFactors(
    result: SearchResult, 
    originalQuery: string
  ): RankingFactors {
    return {
      semanticSimilarity: result.similarity,
      titleRelevance: this.calculateTitleRelevance(result.title, originalQuery),
      contentQuality: this.calculateContentQuality(result.content),
      documentType: this.calculateDocumentType(result.filename, result.content),
      recency: this.calculateRecency(result.metadata),
      sourceReliability: this.calculateSourceReliability(result.sourceUrl, result.filename),
      queryAlignment: this.calculateQueryAlignment(result, originalQuery)
    };
  }

  /**
   * Calculate final ranking score
   */
  private calculateRankingScore(
    factors: RankingFactors, 
    config: RankingConfig
  ): number {
    const weights = config.weights;
    
    return (
      factors.semanticSimilarity * weights.semanticSimilarity +
      factors.titleRelevance * weights.titleRelevance +
      factors.contentQuality * weights.contentQuality +
      factors.documentType * weights.documentType +
      factors.recency * weights.recency +
      factors.sourceReliability * weights.sourceReliability +
      factors.queryAlignment * weights.queryAlignment
    );
  }

  /**
   * Apply document type boosts
   */
  private applyBoosts(score: number, result: SearchResult, config: RankingConfig): number {
    const filename_lower = result.filename.toLowerCase();
    const content_lower = result.content.toLowerCase();
    
    if (filename_lower.includes('framework_user') || 
        result.sourceUrl?.includes('frappeframework.com')) {
      score *= config.boosts.officialDocs;
    }
    
    if (filename_lower.includes('tutorial') || content_lower.includes('tutorial')) {
      score *= config.boosts.tutorials;
    }
    
    if (filename_lower.includes('api') || content_lower.includes('api')) {
      score *= config.boosts.apiDocs;
    }
    
    if (filename_lower.includes('example') || content_lower.includes('example')) {
      score *= config.boosts.examples;
    }
    
    return score;
  }

  /**
   * Rank and re-order search results
   */
  rankResults(
    results: SearchResult[], 
    originalQuery: string, 
    config?: Partial<RankingConfig>
  ): RankedResult[] {
    const finalConfig = {
      ...this.defaultConfig,
      ...config,
      weights: { ...this.defaultConfig.weights, ...config?.weights },
      boosts: { ...this.defaultConfig.boosts, ...config?.boosts }
    };

    const rankedResults: RankedResult[] = results.map((result, index) => {
      const factors = this.calculateRankingFactors(result, originalQuery);
      let score = this.calculateRankingScore(factors, finalConfig);
      score = this.applyBoosts(score, result, finalConfig);
      
      return {
        ...result,
        rankingScore: score,
        rankingFactors: factors,
        originalRank: index
      };
    });

    // Sort by ranking score (descending)
    return rankedResults.sort((a, b) => b.rankingScore - a.rankingScore);
  }

  /**
   * Get ranking explanation for debugging
   */
  explainRanking(rankedResult: RankedResult): string {
    const factors = rankedResult.rankingFactors;
    const explanation = [
      `Ranking Score: ${rankedResult.rankingScore.toFixed(3)}`,
      `- Semantic Similarity: ${factors.semanticSimilarity.toFixed(3)}`,
      `- Title Relevance: ${factors.titleRelevance.toFixed(3)}`,
      `- Content Quality: ${factors.contentQuality.toFixed(3)}`,
      `- Document Type: ${factors.documentType.toFixed(3)}`,
      `- Source Reliability: ${factors.sourceReliability.toFixed(3)}`,
      `- Query Alignment: ${factors.queryAlignment.toFixed(3)}`,
      `- Search Strategy: ${rankedResult.searchStrategy}`,
      `- Original Rank: ${rankedResult.originalRank + 1}`
    ];
    
    return explanation.join('\n');
  }
}