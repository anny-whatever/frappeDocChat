import { ChatOpenAI } from "@langchain/openai";
import { SearchResult } from "./multiQueryService.js";
import { RankedResult } from "./resultRankingService.js";

export interface RefinementContext {
  originalQuery: string;
  searchResults: RankedResult[];
  iteration: number;
  maxIterations: number;
  confidenceThreshold: number;
  gapsIdentified: string[];
  followUpQueries: string[];
}

export interface GapAnalysis {
  informationGaps: string[];
  missingTopics: string[];
  ambiguousAreas: string[];
  needsMoreDetail: string[];
  confidence: number;
}

export interface RefinementResult {
  shouldRefine: boolean;
  followUpQueries: string[];
  gapAnalysis: GapAnalysis;
  refinementReason: string;
  confidence: number;
}

export interface IterativeSearchResult {
  finalResults: RankedResult[];
  iterations: {
    iteration: number;
    query: string;
    results: RankedResult[];
    gapAnalysis: GapAnalysis;
    refinementApplied: boolean;
  }[];
  totalIterations: number;
  convergenceReached: boolean;
  finalConfidence: number;
}

export class IterativeRefinementService {
  private static instance: IterativeRefinementService;
  private llm: ChatOpenAI;

  private constructor() {
    this.llm = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 1000,
    });
  }

  static getInstance(): IterativeRefinementService {
    if (!IterativeRefinementService.instance) {
      IterativeRefinementService.instance = new IterativeRefinementService();
    }
    return IterativeRefinementService.instance;
  }

  /**
   * Analyze search results to identify information gaps
   */
  async analyzeInformationGaps(
    originalQuery: string,
    results: RankedResult[]
  ): Promise<GapAnalysis> {
    if (results.length === 0) {
      return {
        informationGaps: ["No results found"],
        missingTopics: ["All topics"],
        ambiguousAreas: [],
        needsMoreDetail: [],
        confidence: 0
      };
    }

    const prompt = `
Analyze the search results for the query "${originalQuery}" and identify information gaps.

Search Results Summary:
${results.slice(0, 5).map((result, index) => `
${index + 1}. Title: ${result.title}
   Content Preview: ${result.content.substring(0, 200)}...
   Source: ${result.filename}
   Ranking Score: ${result.rankingScore.toFixed(3)}
`).join('\n')}

Please analyze these results and identify:
1. Information gaps - What important information is missing?
2. Missing topics - What related topics should be covered but aren't?
3. Ambiguous areas - What parts need clarification?
4. Areas needing more detail - What topics are mentioned but need deeper explanation?
5. Overall confidence - How well do these results answer the original query? (0-1)

Respond in JSON format:
{
  "informationGaps": ["gap1", "gap2"],
  "missingTopics": ["topic1", "topic2"],
  "ambiguousAreas": ["area1", "area2"],
  "needsMoreDetail": ["detail1", "detail2"],
  "confidence": 0.8
}
`;

    try {
      const response = await this.llm.invoke(prompt);
      let content = response.content as string;
      
      // Clean up the response - remove markdown code blocks if present
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      
      const analysis = JSON.parse(content);
      
      return {
        informationGaps: analysis.informationGaps || [],
        missingTopics: analysis.missingTopics || [],
        ambiguousAreas: analysis.ambiguousAreas || [],
        needsMoreDetail: analysis.needsMoreDetail || [],
        confidence: Math.max(0, Math.min(1, analysis.confidence || 0))
      };
    } catch (error) {
      console.error('Error analyzing information gaps:', error);
      
      // Fallback analysis based on result quality
      const avgScore = results.reduce((sum, r) => sum + r.rankingScore, 0) / results.length;
      const confidence = Math.min(1, avgScore);
      
      return {
        informationGaps: confidence < 0.6 ? ["Low quality results"] : [],
        missingTopics: results.length < 3 ? ["Insufficient coverage"] : [],
        ambiguousAreas: [],
        needsMoreDetail: confidence < 0.7 ? ["More detailed information needed"] : [],
        confidence
      };
    }
  }

  /**
   * Generate follow-up queries based on gap analysis
   */
  async generateFollowUpQueries(
    originalQuery: string,
    gapAnalysis: GapAnalysis,
    previousQueries: string[] = []
  ): Promise<string[]> {
    if (gapAnalysis.confidence > 0.85) {
      return []; // High confidence, no follow-up needed
    }

    const prompt = `
Original Query: "${originalQuery}"

Gap Analysis:
- Information Gaps: ${gapAnalysis.informationGaps.join(', ')}
- Missing Topics: ${gapAnalysis.missingTopics.join(', ')}
- Ambiguous Areas: ${gapAnalysis.ambiguousAreas.join(', ')}
- Needs More Detail: ${gapAnalysis.needsMoreDetail.join(', ')}
- Current Confidence: ${gapAnalysis.confidence}

Previous Queries Used: ${previousQueries.join(', ')}

Generate 2-4 specific follow-up queries that would help fill these information gaps. 
Focus on:
1. Addressing the most critical gaps first
2. Being specific and actionable
3. Avoiding repetition of previous queries
4. Targeting Frappe Framework documentation

Respond with a JSON array of strings:
["query1", "query2", "query3"]
`;

    try {
      const response = await this.llm.invoke(prompt);
      let content = response.content as string;
      
      // Clean up the response - remove markdown code blocks if present
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      
      const queries = JSON.parse(content);
      
      if (Array.isArray(queries)) {
        return queries.filter(q => 
          typeof q === 'string' && 
          q.length > 10 && 
          !previousQueries.some(prev => 
            this.calculateQuerySimilarity(q.toLowerCase(), prev.toLowerCase()) > 0.8
          )
        );
      }
      
      return [];
    } catch (error) {
      console.error('Error generating follow-up queries:', error);
      
      // Fallback query generation
      const fallbackQueries: string[] = [];
      
      if (gapAnalysis.missingTopics.length > 0) {
        fallbackQueries.push(`${originalQuery} ${gapAnalysis.missingTopics[0]}`);
      }
      
      if (gapAnalysis.needsMoreDetail.length > 0) {
        fallbackQueries.push(`${gapAnalysis.needsMoreDetail[0]} detailed explanation`);
      }
      
      if (gapAnalysis.informationGaps.length > 0) {
        fallbackQueries.push(`${originalQuery} ${gapAnalysis.informationGaps[0]}`);
      }
      
      return fallbackQueries.slice(0, 2);
    }
  }

  /**
   * Calculate similarity between two queries
   */
  private calculateQuerySimilarity(query1: string, query2: string): number {
    const words1 = query1.split(/\s+/);
    const words2 = query2.split(/\s+/);
    
    const commonWords = words1.filter(word => 
      words2.some(w => w.includes(word) || word.includes(w))
    );
    
    return commonWords.length / Math.max(words1.length, words2.length);
  }

  /**
   * Determine if refinement is needed
   */
  async shouldRefineSearch(
    context: RefinementContext
  ): Promise<RefinementResult> {
    // Don't refine if we've reached max iterations
    if (context.iteration >= context.maxIterations) {
      return {
        shouldRefine: false,
        followUpQueries: [],
        gapAnalysis: {
          informationGaps: [],
          missingTopics: [],
          ambiguousAreas: [],
          needsMoreDetail: [],
          confidence: 1
        },
        refinementReason: "Maximum iterations reached",
        confidence: 1
      };
    }

    const gapAnalysis = await this.analyzeInformationGaps(
      context.originalQuery,
      context.searchResults
    );

    // Don't refine if confidence is high enough
    if (gapAnalysis.confidence >= context.confidenceThreshold) {
      return {
        shouldRefine: false,
        followUpQueries: [],
        gapAnalysis,
        refinementReason: "Confidence threshold met",
        confidence: gapAnalysis.confidence
      };
    }

    // Generate follow-up queries
    const followUpQueries = await this.generateFollowUpQueries(
      context.originalQuery,
      gapAnalysis,
      context.followUpQueries
    );

    const shouldRefine = followUpQueries.length > 0 && 
                        gapAnalysis.confidence < context.confidenceThreshold;

    return {
      shouldRefine,
      followUpQueries,
      gapAnalysis,
      refinementReason: shouldRefine ? 
        `Low confidence (${gapAnalysis.confidence.toFixed(2)}) - gaps identified` : 
        "No actionable follow-up queries generated",
      confidence: gapAnalysis.confidence
    };
  }

  /**
   * Merge and deduplicate results from multiple iterations
   */
  mergeIterativeResults(
    allResults: RankedResult[][],
    originalQuery: string
  ): RankedResult[] {
    const mergedResults = new Map<string, RankedResult>();
    
    // Flatten all results
    const flatResults = allResults.flat();
    
    // Deduplicate based on content similarity and filename
    for (const result of flatResults) {
      const key = `${result.filename}_${result.title}`;
      
      if (!mergedResults.has(key)) {
        mergedResults.set(key, result);
      } else {
        // Keep the one with higher ranking score
        const existing = mergedResults.get(key)!;
        if (result.rankingScore > existing.rankingScore) {
          mergedResults.set(key, result);
        }
      }
    }
    
    // Sort by ranking score
    return Array.from(mergedResults.values())
      .sort((a, b) => b.rankingScore - a.rankingScore);
  }

  /**
   * Calculate convergence based on result stability
   */
  private calculateConvergence(
    previousResults: RankedResult[],
    currentResults: RankedResult[]
  ): boolean {
    if (previousResults.length === 0) return false;
    
    // Check if top 5 results are similar
    const topPrevious = previousResults.slice(0, 5);
    const topCurrent = currentResults.slice(0, 5);
    
    let similarCount = 0;
    for (const prevResult of topPrevious) {
      const found = topCurrent.some(currResult => 
        currResult.filename === prevResult.filename &&
        currResult.title === prevResult.title
      );
      if (found) similarCount++;
    }
    
    // Consider converged if 60% of top results are the same
    return (similarCount / Math.max(topPrevious.length, topCurrent.length)) >= 0.6;
  }

  /**
   * Execute iterative search with refinement
   */
  async executeIterativeSearch(
    originalQuery: string,
    initialResults: RankedResult[],
    searchFunction: (query: string) => Promise<RankedResult[]>,
    options: {
      maxIterations?: number;
      confidenceThreshold?: number;
    } = {}
  ): Promise<IterativeSearchResult> {
    const maxIterations = options.maxIterations || 3;
    const confidenceThreshold = options.confidenceThreshold || 0.75;
    
    const iterations: IterativeSearchResult['iterations'] = [];
    let currentResults = initialResults;
    let allQueries = [originalQuery];
    let convergenceReached = false;
    
    // Initial iteration
    const initialGapAnalysis = await this.analyzeInformationGaps(originalQuery, currentResults);
    iterations.push({
      iteration: 0,
      query: originalQuery,
      results: currentResults,
      gapAnalysis: initialGapAnalysis,
      refinementApplied: false
    });

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const context: RefinementContext = {
        originalQuery,
        searchResults: currentResults,
        iteration,
        maxIterations,
        confidenceThreshold,
        gapsIdentified: [],
        followUpQueries: allQueries
      };

      const refinementResult = await this.shouldRefineSearch(context);
      
      if (!refinementResult.shouldRefine) {
        convergenceReached = true;
        break;
      }

      // Execute follow-up searches
      const iterationResults: RankedResult[] = [];
      for (const followUpQuery of refinementResult.followUpQueries) {
        try {
          const queryResults = await searchFunction(followUpQuery);
          iterationResults.push(...queryResults);
          allQueries.push(followUpQuery);
        } catch (error) {
          console.error(`Error executing follow-up query "${followUpQuery}":`, error);
        }
      }

      // Check for convergence
      const previousResults = currentResults;
      currentResults = this.mergeIterativeResults([currentResults, iterationResults], originalQuery);
      
      if (this.calculateConvergence(previousResults, currentResults)) {
        convergenceReached = true;
      }

      iterations.push({
        iteration,
        query: refinementResult.followUpQueries.join(' | '),
        results: iterationResults,
        gapAnalysis: refinementResult.gapAnalysis,
        refinementApplied: true
      });

      if (convergenceReached) break;
    }

    const finalGapAnalysis = await this.analyzeInformationGaps(originalQuery, currentResults);

    return {
      finalResults: currentResults,
      iterations,
      totalIterations: iterations.length - 1, // Exclude initial iteration
      convergenceReached,
      finalConfidence: finalGapAnalysis.confidence
    };
  }

  /**
   * Get refinement summary for debugging
   */
  getRefinementSummary(result: IterativeSearchResult): string {
    const summary = [
      `Iterative Search Summary:`,
      `- Total Iterations: ${result.totalIterations}`,
      `- Convergence Reached: ${result.convergenceReached}`,
      `- Final Confidence: ${result.finalConfidence.toFixed(3)}`,
      `- Final Results Count: ${result.finalResults.length}`,
      ``,
      `Iteration Details:`
    ];

    result.iterations.forEach((iteration, index) => {
      summary.push(`${index}. ${iteration.refinementApplied ? 'Refinement' : 'Initial'}: ${iteration.query}`);
      summary.push(`   Results: ${iteration.results.length}, Confidence: ${iteration.gapAnalysis.confidence.toFixed(3)}`);
      if (iteration.gapAnalysis.informationGaps.length > 0) {
        summary.push(`   Gaps: ${iteration.gapAnalysis.informationGaps.join(', ')}`);
      }
    });

    return summary.join('\n');
  }
}