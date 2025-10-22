import { ChatOpenAI } from "@langchain/openai";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { EmbeddingService } from "./embeddingService.js";
import { DatabaseService } from "./databaseService.js";
import { ConversationService } from "./conversationService.js";
import { QueryDecompositionService } from "./queryDecompositionService.js";
import { QueryExpansionService } from "./queryExpansionService.js";
import { MultiQueryService, SearchResult } from "./multiQueryService.js";
import { ResultRankingService, RankedResult } from "./resultRankingService.js";
import { IterativeRefinementService, IterativeSearchResult } from "./iterativeRefinementService.js";
import dotenv from "dotenv";

dotenv.config();

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
  userId?: string;
}

export interface ChatResponse {
  response: string;
  conversationId: string;
  sources?: Array<{
    id: string;
    title: string;
    content: string;
    similarity: number;
    sourceUrl?: string;
    rankingScore?: number;
    searchStrategy?: string;
  }>;
  agenticMetadata?: {
    queriesUsed: string[];
    iterationsPerformed: number;
    finalConfidence: number;
    convergenceReached: boolean;
    totalResultsConsidered: number;
    processingTimeMs: number;
  };
}

export class AgentService {
  private static instance: AgentService;
  private chatModel: ChatOpenAI;
  private embeddingService: EmbeddingService;
  private databaseService: DatabaseService;
  private conversationService: ConversationService;
  private queryDecompositionService: QueryDecompositionService;
  private queryExpansionService: QueryExpansionService;
  private multiQueryService: MultiQueryService;
  private resultRankingService: ResultRankingService;
  private iterativeRefinementService: IterativeRefinementService;

  private constructor() {
    this.chatModel = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: "gpt-4o-mini",
      temperature: 0.7,
    });

    this.embeddingService = EmbeddingService.getInstance();
    this.databaseService = DatabaseService.getInstance();
    this.conversationService = ConversationService.getInstance();
    this.queryDecompositionService = QueryDecompositionService.getInstance();
    this.queryExpansionService = QueryExpansionService.getInstance();
    this.multiQueryService = MultiQueryService.getInstance();
    this.resultRankingService = ResultRankingService.getInstance();
    this.iterativeRefinementService = IterativeRefinementService.getInstance();
  }

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  /**
   * Create a RAG prompt template with context and conversation history
   */
  private createRAGPrompt(): ChatPromptTemplate {
    return ChatPromptTemplate.fromMessages([
      [
        "system",
        `You are a helpful AI assistant that answers questions based on the provided documentation context. 
        
        Use the following context to answer the user's question. If the context doesn't contain enough information to answer the question, say so clearly.
        
        Context:
        {context}
        
        Guidelines:
        - Always base your answers on the provided context
        - If you're unsure or the context doesn't contain the information, be honest about it
        - Provide specific references to the documentation when possible
        - Be concise but comprehensive in your responses
        - If the user asks about something not in the context, suggest they might need to check other documentation or resources`,
      ],
      new MessagesPlaceholder("chat_history"),
      ["human", "{question}"],
    ]);
  }

  /**
   * Enhanced agentic RAG search with multi-query, ranking, and iterative refinement
   */
  private async performAgenticRAGSearch(
    query: string,
    options: {
      limit?: number;
      threshold?: number;
      enableIterativeRefinement?: boolean;
      maxIterations?: number;
      confidenceThreshold?: number;
    } = {}
  ): Promise<{
    results: RankedResult[];
    metadata: {
      queriesUsed: string[];
      iterationsPerformed: number;
      finalConfidence: number;
      convergenceReached: boolean;
      totalResultsConsidered: number;
      processingTimeMs: number;
    };
  }> {
    const startTime = Date.now();
    const {
      limit = 10,
      threshold = 0.3,
      enableIterativeRefinement = true,
      maxIterations = 3,
      confidenceThreshold = 0.75
    } = options;

    try {
      // Step 1: Execute multi-query search
      const multiQueryResult = await this.multiQueryService.executeMultiQuery(
        query,
        limit * 2 // Get more results for ranking
      );

      // Step 2: Rank the results
      const rankedResults = this.resultRankingService.rankResults(
        multiQueryResult.deduplicatedResults,
        query
      );

      let finalResults = rankedResults.slice(0, limit);
      let iterativeResult: IterativeSearchResult | null = null;

      // Step 3: Iterative refinement if enabled and confidence is low
      if (enableIterativeRefinement) {
        const searchFunction = async (refinementQuery: string): Promise<RankedResult[]> => {
          const refinementResult = await this.multiQueryService.executeMultiQuery(
            refinementQuery,
            limit
          );
          return this.resultRankingService.rankResults(refinementResult.deduplicatedResults, query);
        };

        iterativeResult = await this.iterativeRefinementService.executeIterativeSearch(
          query,
          finalResults,
          searchFunction,
          { maxIterations, confidenceThreshold }
        );

        finalResults = iterativeResult.finalResults.slice(0, limit);
      }

      const processingTime = Date.now() - startTime;

      // Collect all unique queries used
      const allQueries = new Set([query, ...multiQueryResult.searchStrategies]);
      if (iterativeResult) {
        iterativeResult.iterations.forEach(iteration => {
          if (iteration.query !== query) {
            iteration.query.split(' | ').forEach(q => allQueries.add(q));
          }
        });
      }

      return {
        results: finalResults,
        metadata: {
          queriesUsed: Array.from(allQueries),
          iterationsPerformed: iterativeResult?.totalIterations || 0,
          finalConfidence: iterativeResult?.finalConfidence || 
                          (rankedResults.length > 0 ? rankedResults[0].rankingScore : 0),
          convergenceReached: iterativeResult?.convergenceReached || false,
          totalResultsConsidered: multiQueryResult.allResults.length + 
                                 (iterativeResult?.iterations.reduce((sum, iter) => 
                                   sum + iter.results.length, 0) || 0),
          processingTimeMs: processingTime
        }
      };
    } catch (error) {
      console.error("Error in agentic RAG search:", error);
      
      // Fallback to simple search
      try {
        const queryEmbedding = await this.embeddingService.generateQueryEmbedding(query);
        const documents = await this.databaseService.searchSimilarDocuments(
          queryEmbedding,
          limit,
          threshold
        );

        const fallbackResults: RankedResult[] = documents.map((doc, index) => ({
          ...doc,
          similarity: doc.similarity || 0,
          queryUsed: query,
          searchStrategy: 'fallback' as const,
          rankingScore: doc.similarity || 0,
          rankingFactors: {
            semanticSimilarity: doc.similarity || 0,
            titleRelevance: 0.5,
            contentQuality: 0.5,
            documentType: 0.5,
            recency: 0.5,
            sourceReliability: 0.5,
            queryAlignment: 1.0
          },
          originalRank: index
        }));

        return {
          results: fallbackResults,
          metadata: {
            queriesUsed: [query],
            iterationsPerformed: 0,
            finalConfidence: 0.5,
            convergenceReached: false,
            totalResultsConsidered: documents.length,
            processingTimeMs: Date.now() - startTime
          }
        };
      } catch (fallbackError) {
        console.error("Fallback search also failed:", fallbackError);
        return {
          results: [],
          metadata: {
            queriesUsed: [query],
            iterationsPerformed: 0,
            finalConfidence: 0,
            convergenceReached: false,
            totalResultsConsidered: 0,
            processingTimeMs: Date.now() - startTime
          }
        };
      }
    }
  }

  /**
   * Convert conversation history to LangChain messages
   */
  private convertToLangChainMessages(history: ChatMessage[]): BaseMessage[] {
    return history
      .map((msg) => {
        if (msg.role === "user") {
          return new HumanMessage(msg.content);
        } else if (msg.role === "assistant") {
          return new AIMessage(msg.content);
        }
        // Skip system messages for now
        return null;
      })
      .filter(Boolean) as BaseMessage[];
  }

  /**
   * Process a chat message with RAG and conversation history
   */
  async processMessage(request: ChatRequest): Promise<ChatResponse> {
    try {
      const { message, conversationId, userId = "default" } = request;

      // Get or create conversation
      let currentConversationId = conversationId;
      if (!currentConversationId) {
        const conversation = await this.conversationService.createConversation({
          userId,
          title: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
        });
        currentConversationId = conversation.id;
      }

      // Retrieve conversation history
      const conversationHistory =
        await this.conversationService.getConversationHistory(
          currentConversationId
        );

      // Convert to LangChain messages
      const chatHistory = this.convertToLangChainMessages(
        conversationHistory.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content || "",
          timestamp: new Date(),
        }))
      );

      // Perform agentic RAG search
      const ragSearchResult = await this.performAgenticRAGSearch(message, {
        limit: 8,
        threshold: 0.3,
        enableIterativeRefinement: true,
        maxIterations: 2,
        confidenceThreshold: 0.7
      });

      const relevantDocs = ragSearchResult.results;

      // Create context from retrieved documents
      const context = relevantDocs
        .map(
          (doc, index) =>
            `Document ${index + 1} (${doc.title}):\n${doc.content}\n---`
        )
        .join("\n\n");

      // Create the RAG chain
      const prompt = this.createRAGPrompt();
      const chain = RunnableSequence.from([
        prompt,
        this.chatModel,
        new StringOutputParser(),
      ]);

      // Generate response
      const response = await chain.invoke({
        context,
        chat_history: chatHistory,
        question: message,
      });

      // Save user message to conversation
      await this.conversationService.addMessage({
        conversationId: currentConversationId,
        role: "user",
        content: message,
      });

      // Save assistant response to conversation
      await this.conversationService.addMessage({
        conversationId: currentConversationId,
        role: "assistant",
        content: response,
      });

      // Prepare sources for response
      const sources = relevantDocs.map((doc) => ({
        id: doc.id,
        title: doc.title,
        content:
          doc.content.substring(0, 200) +
          (doc.content.length > 200 ? "..." : ""),
        similarity: doc.similarity || 0,
        sourceUrl: doc.sourceUrl,
        rankingScore: doc.rankingScore,
        searchStrategy: doc.searchStrategy,
      }));

      return {
        response,
        conversationId: currentConversationId,
        sources,
        agenticMetadata: ragSearchResult.metadata,
      };
    } catch (error) {
      console.error("Error processing message:", error);
      throw new Error("Failed to process message");
    }
  }

  /**
   * Get conversation history for a specific conversation
   */
  async getConversationHistory(conversationId: string): Promise<ChatMessage[]> {
    try {
      const history = await this.conversationService.getConversationHistory(
        conversationId
      );
      return history.map((msg) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content || "",
        timestamp: new Date(),
      }));
    } catch (error) {
      console.error("Error getting conversation history:", error);
      return [];
    }
  }

  /**
   * Get all conversations for a user
   */
  async getUserConversations(userId: string) {
    try {
      return await this.conversationService.getConversations(userId);
    } catch (error) {
      console.error("Error getting user conversations:", error);
      return [];
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: string): Promise<void> {
    try {
      await this.conversationService.deleteConversation(conversationId);
    } catch (error) {
      console.error("Error deleting conversation:", error);
      throw new Error("Failed to delete conversation");
    }
  }
}
