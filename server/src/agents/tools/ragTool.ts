import { Tool } from "../toolRegistry.js";
import { EmbeddingService } from "../../services/embeddingService.js";
import { DatabaseService } from "../../services/databaseService.js";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * RAG Tool - Retrieves relevant documentation using vector search
 * Supports multi-query expansion for better results
 */
export const createRagTool = (): Tool => {
  const embeddingService = EmbeddingService.getInstance();
  const databaseService = DatabaseService.getInstance();

  return {
    name: "search_documentation",
    description:
      "Search through Frappe documentation using semantic search. Use this when you need to find information about Frappe framework, DocTypes, APIs, or any technical documentation.",
    parameters: [
      {
        name: "queries",
        type: "array",
        description:
          "Array of search queries (can be multiple variations of the same question for better results)",
        required: true,
      },
      {
        name: "limit",
        type: "number",
        description: "Maximum number of results per query (default: 5)",
        required: false,
      },
    ],
    execute: async (args: Record<string, any>) => {
      try {
        const queries = args.queries as string[];
        const limit = args.limit || 5;
        const threshold = 0.3;

        if (!queries || !Array.isArray(queries) || queries.length === 0) {
          throw new Error("At least one query is required");
        }

        console.log(`🔍 Executing RAG search with ${queries.length} queries`);

        // Search with each query and collect results
        const allResults: any[] = [];
        const seenIds = new Set<string>();

        for (const query of queries) {
          console.log(`  - Searching: "${query}"`);
          const queryEmbedding = await embeddingService.generateQueryEmbedding(
            query
          );
          const results = await databaseService.searchSimilarDocuments(
            queryEmbedding,
            limit,
            threshold
          );

          // Add unique results only
          for (const result of results) {
            if (!seenIds.has(result.id)) {
              seenIds.add(result.id);
              allResults.push(result);
            }
          }
        }

        // Sort by similarity and take top results
        allResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        const topResults = allResults.slice(0, limit * 2); // Get more results for better context

        console.log(`✅ Found ${topResults.length} unique results`);

        return {
          success: true,
          results: topResults,
          count: topResults.length,
          queries: queries,
        };
      } catch (error) {
        console.error("RAG tool execution error:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          results: [],
          count: 0,
        };
      }
    },
  };
};

/**
 * Expands a single user query into multiple search queries for better RAG results
 */
export async function expandQuery(userQuery: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a query expansion expert. Your task is to take a user's question and generate 3-5 different variations of the same question that would help retrieve better search results from a documentation database.

Rules:
1. Generate 3-5 variations
2. Keep the core intent the same
3. Use different wordings and phrasings
4. Include both technical and conversational versions
5. Return ONLY a JSON array of strings, no other text

Example:
User query: "How do I create a DocType?"
Your response: ["How to create a DocType in Frappe", "Creating new DocType", "DocType creation steps", "Add new DocType to Frappe Framework"]`,
        },
        {
          role: "user",
          content: userQuery,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0].message.content?.trim() || "[]";

    // Parse the JSON response
    let expandedQueries: string[] = [];
    try {
      expandedQueries = JSON.parse(content);
    } catch (e) {
      // If parsing fails, try to extract array from the content
      const arrayMatch = content.match(/\[.*\]/s);
      if (arrayMatch) {
        expandedQueries = JSON.parse(arrayMatch[0]);
      } else {
        // Fallback to original query
        expandedQueries = [userQuery];
      }
    }

    // Always include the original query
    if (!expandedQueries.includes(userQuery)) {
      expandedQueries.unshift(userQuery);
    }

    console.log(
      `📝 Expanded query into ${expandedQueries.length} variations:`,
      expandedQueries
    );

    return expandedQueries;
  } catch (error) {
    console.error("Error expanding query:", error);
    // Return original query as fallback
    return [userQuery];
  }
}
