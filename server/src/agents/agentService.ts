import OpenAI from "openai";
import dotenv from "dotenv";
import express from "express";
import { ToolRegistry } from "./toolRegistry.ts";
import { createRagTool, expandQuery } from "./tools/ragTool.ts";

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface Message {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface AgentResponse {
  response: string;
  toolCalls: any[];
  conversationHistory: Message[];
}

/**
 * Agent Service - Manages the agentic workflow with GPT-4o-mini
 * Uses tool registry to provide RAG and other capabilities
 */
export class AgentService {
  private static instance: AgentService;
  private toolRegistry: ToolRegistry;
  // Input token budgeting for conversation windowing
  private static readonly INPUT_TOKEN_LIMIT = 10000; // max input tokens
  private static readonly OUTPUT_TOKEN_BUDGET = 1024; // reserve for model output
  private static readonly CHARS_PER_TOKEN_APPROX = 4; // ~1 token ≈ 4 chars

  private constructor() {
    this.toolRegistry = ToolRegistry.getInstance();
    this.initializeTools();
  }

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }
    return AgentService.instance;
  }

  /**
   * Initialize all tools in the registry
   */
  private initializeTools(): void {
    // Register RAG tool
    const ragTool = createRagTool();
    this.toolRegistry.registerTool(ragTool);

    console.log("🤖 Agent service initialized with tools");
  }

  /**
   * Approximate token count for text
   */
  private estimateTokens(text: string | null | undefined): number {
    if (!text) return 0;
    return Math.ceil(text.length / AgentService.CHARS_PER_TOKEN_APPROX);
  }

  /**
   * Compute approximate token count for a message
   */
  private messageTokenCount(message: Message): number {
    // Include role/name overhead roughly
    const baseOverhead = 6;
    const contentTokens = this.estimateTokens(
      typeof message.content === "string" ? message.content : ""
    );
    // tool/function metadata is relatively small compared to content; ignore for budget
    return baseOverhead + contentTokens;
  }

  /**
   * Trim conversation history to fit within input token budget
   * Always keeps the most recent messages, plus system prompt is added separately by caller
   */
  private trimHistoryForBudget(
    history: Message[],
    userMessage: string
  ): Message[] {
    const maxInputTokens =
      AgentService.INPUT_TOKEN_LIMIT - AgentService.OUTPUT_TOKEN_BUDGET;

    const reversed: Message[] = [...history].reverse();
    const result: Message[] = [];
    let runningTokens = this.estimateTokens(userMessage) + 10; // include current user text

    for (const msg of reversed) {
      const tokens = this.messageTokenCount(msg);
      if (runningTokens + tokens > maxInputTokens) break;
      result.push(msg);
      runningTokens += tokens;
    }

    return result.reverse();
  }

  /**
   * Sanitize tool results for conversation context
   */
  private sanitizeToolResult(raw: any): any {
    if (typeof raw === "string") {
      return { result: raw };
    }

    if (Array.isArray(raw)) {
      return {
        results: raw.map((item) => {
          if (typeof item === "object" && item !== null) {
            // Keep only essential fields for context
            return {
              content: item.content || item.text || item.title || "",
              source: item.source || item.url || "",
              score: item.score || item.similarity || 0,
            };
          }
          return item;
        }),
        count: raw.length,
      };
    }

    if (typeof raw === "object" && raw !== null) {
      return {
        ...raw,
        // Ensure we don't pass huge objects
        content: raw.content || raw.text || raw.title || "",
        source: raw.source || raw.url || "",
      };
    }

    return raw;
  }

  /**
   * Prepare search query from user message and conversation context
   */
  private prepareSearchQuery(message: string, conversationHistory: Message[]): string {
    // For now, use the message directly, but could be enhanced with context
    return message;
  }

  /**
   * Search documentation using the RAG tool
   */
  private async searchDocumentation(query: string): Promise<any> {
    try {
      const expandedQueries = await expandQuery(query);
      const result = await this.toolRegistry.executeTool("search_documentation", {
        queries: expandedQueries,
        limit: 5
      });
      return result;
    } catch (error) {
      console.error("❌ Error searching documentation:", error);
      return { results: [], error: "Search failed" };
    }
  }

  /**
   * Build system message with search results context
   */
  private buildSystemMessage(searchResults: any): string {
    const baseSystemMessage = `You are an expert Frappe Framework assistant. You help developers understand and use the Frappe framework effectively.

Your capabilities:
- You have access to the Frappe documentation through a search tool
- You can search multiple variations of a query to find the best information
- You provide accurate, helpful, and well-formatted answers

When answering:
1. Use the provided documentation context to answer questions accurately
2. Cite the documentation sources you found
3. If you can't find information, say so clearly
4. Be concise but thorough

Remember: Base your answers on the provided documentation context.`;

    if (searchResults && searchResults.results && searchResults.results.length > 0) {
      const contextSection = "\n\nDocumentation Context:\n" + 
        searchResults.results.map((result: any, index: number) => 
          `${index + 1}. ${result.content || result.text || 'No content'}\n   Source: ${result.source || 'Unknown'}`
        ).join('\n\n');
      
      return baseSystemMessage + contextSection;
    }

    return baseSystemMessage;
  }

  /**
   * Process a user message through the agentic workflow
   */
  async processMessage(
    userMessage: string,
    conversationHistory: Message[] = []
  ): Promise<AgentResponse> {
    try {
      console.log(`\n🤖 Processing message: "${userMessage}"`);

      // Build conversation with system prompt and trimmed history window
      const trimmedHistory = this.trimHistoryForBudget(
        conversationHistory,
        userMessage
      );
      const messages: Message[] = [
        {
          role: "system",
          content: `You are an expert Frappe Framework assistant. You help developers understand and use the Frappe framework effectively.

Your capabilities:
- You have access to the Frappe documentation through a search tool
- You can search multiple variations of a query to find the best information
- You provide accurate, helpful, and well-formatted answers

When answering:
1. ALWAYS use the search_documentation tool to find relevant information
2. Generate 3-5 different query variations to get comprehensive results
3. Cite the documentation sources you found
4. If you can't find information, say so clearly
5. Be concise but thorough

Remember: Use the search tool before answering any Frappe-related questions.`,
        },
        ...trimmedHistory,
        {
          role: "user",
          content: userMessage,
        },
      ];

      // First, expand the query into multiple variations
      const expandedQueries = await expandQuery(userMessage);

      // Start the agent loop
      let response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages as any[],
        tools: this.toolRegistry.getToolsForOpenAI(),
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens: AgentService.OUTPUT_TOKEN_BUDGET,
      });

      let assistantMessage = response.choices[0].message;
      messages.push(assistantMessage as Message);

      const allToolCalls: any[] = [];
      let iterations = 0;
      const MAX_ITERATIONS = 5;

      // Agent loop - keep calling tools until agent responds with text
      while (assistantMessage.tool_calls && iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`🔄 Agent iteration ${iterations}`);

        // Execute all tool calls
        for (const toolCall of assistantMessage.tool_calls) {
          console.log(`🔧 Tool call: ${toolCall.function.name}`);

          allToolCalls.push(toolCall);

          try {
            let args = JSON.parse(toolCall.function.arguments);

            // If the tool is search_documentation and we have expanded queries, use them
            if (toolCall.function.name === "search_documentation") {
              if (!args.queries || args.queries.length === 0) {
                args.queries = expandedQueries;
              }
            }

            const toolResult = await this.toolRegistry.executeTool(
              toolCall.function.name,
              args
            );

            // Add tool response to conversation
            messages.push({
              role: "tool",
              content: JSON.stringify(this.sanitizeToolResult(toolResult)),
              tool_call_id: toolCall.id,
            });
          } catch (error) {
            console.error(
              `Error executing tool ${toolCall.function.name}:`,
              error
            );
            messages.push({
              role: "tool",
              content: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
              }),
              tool_call_id: toolCall.id,
            });
          }
        }

        // Get next response from agent
        response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: messages as any[],
          tools: this.toolRegistry.getToolsForOpenAI(),
          tool_choice: "auto",
          temperature: 0.7,
          max_tokens: AgentService.OUTPUT_TOKEN_BUDGET,
        });

        assistantMessage = response.choices[0].message;
        messages.push(assistantMessage as Message);
      }

      if (iterations >= MAX_ITERATIONS) {
        console.warn("⚠️ Max iterations reached");
      }

      const finalResponse =
        assistantMessage.content ||
        "I apologize, but I was unable to generate a response.";

      console.log(`✅ Agent completed with ${iterations} iterations`);

      return {
        response: finalResponse,
        toolCalls: allToolCalls,
        conversationHistory: messages,
      };
    } catch (error) {
      console.error("Agent error:", error);
      throw new Error(
        `Agent processing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Process a message with streaming response using proper OpenAI SDK v4 streaming
   */
  async processMessageStream(
    message: string,
    conversationHistory: Message[] = [],
    res: express.Response,
    isConnectionClosed: () => boolean
  ): Promise<void> {
    console.log(`\n🤖 Processing message (streaming): "${message}"`);

    // Helper function to write SSE data safely
    const writeSSE = (event: string, data: any): boolean => {
      if (isConnectionClosed()) {
        console.log("🛑 Connection closed, stopping SSE write");
        return false;
      }
      
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
      } catch (error) {
        console.error("❌ Error writing SSE:", error);
        return false;
      }
    };

    const maxIterations = 5;
    let iteration = 0;
    let currentMessages: Message[] = [
      ...conversationHistory,
      { role: "user", content: message }
    ];

    try {
      while (iteration < maxIterations) {
        iteration++;
        console.log(`🔄 Agent iteration ${iteration}`);

        if (isConnectionClosed()) {
          console.log("🛑 Connection closed during iteration");
          return;
        }

        // Send status update
        if (!writeSSE("status", { 
          iteration, 
          status: "thinking",
          timestamp: new Date().toISOString()
        })) return;

        // Prepare search query for documentation
        const searchQuery = this.prepareSearchQuery(message, currentMessages);
        console.log(`🔍 Search query: "${searchQuery}"`);

        // Search documentation
        if (!writeSSE("tool_start", { 
          tool: "search_documentation", 
          query: searchQuery,
          timestamp: new Date().toISOString()
        })) return;

        const searchResults = await this.searchDocumentation(searchQuery);
        
        if (!writeSSE("tool_result", { 
          tool: "search_documentation", 
          results: searchResults,
          timestamp: new Date().toISOString()
        })) return;

        // Prepare context for OpenAI
        const systemMessage = this.buildSystemMessage(searchResults);
        const streamMessages: Message[] = [
          { role: "system", content: systemMessage },
          ...currentMessages
        ];

        console.log("🚀 Starting OpenAI streaming...");

        // Create OpenAI stream using proper SDK v4 method
        const stream = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: streamMessages as any[],
          temperature: 0.1,
          max_tokens: 2000,
          stream: true,
          tools: [
            {
              type: "function",
              function: {
                name: "search_documentation",
                description: "Search the Frappe documentation for specific information",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "The search query for documentation"
                    }
                  },
                  required: ["query"]
                }
              }
            }
          ]
        });

        let assistantMessage = "";
        let toolCalls: any[] = [];
        let currentToolCall: any = null;

        // Process stream using async iteration (proper OpenAI SDK v4 method)
        for await (const chunk of stream) {
          if (isConnectionClosed()) {
            console.log("🛑 Connection closed during OpenAI stream");
            return;
          }

          const choice = chunk.choices[0];
          if (!choice) continue;

          const delta = choice.delta;

          // Handle content streaming
          if (delta.content) {
            assistantMessage += delta.content;
            
            // Send token to client
            if (!writeSSE("delta", { 
              content: delta.content,
              timestamp: new Date().toISOString()
            })) return;
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index;
              
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: toolCallDelta.id || "",
                  type: "function",
                  function: {
                    name: toolCallDelta.function?.name || "",
                    arguments: ""
                  }
                };
                currentToolCall = toolCalls[index];
              }

              if (toolCallDelta.function?.arguments) {
                toolCalls[index].function.arguments += toolCallDelta.function.arguments;
              }
            }
          }

          // Check for completion
          if (choice.finish_reason === "stop") {
            console.log("✅ OpenAI stream completed with stop reason");
            break;
          }

          if (choice.finish_reason === "tool_calls") {
            console.log("🔧 OpenAI stream completed with tool calls");
            break;
          }
        }

        // Send completion signal
        if (!writeSSE("completion", { 
          content: assistantMessage,
          finish_reason: "stop",
          timestamp: new Date().toISOString()
        })) return;

        // Process tool calls if any
        if (toolCalls.length > 0) {
          console.log(`🔧 Processing ${toolCalls.length} tool calls`);
          
          // Add assistant message with tool calls
          currentMessages.push({
            role: "assistant",
            content: assistantMessage,
            tool_calls: toolCalls
          });

          // Execute tool calls
          for (const toolCall of toolCalls) {
            if (isConnectionClosed()) return;

            if (toolCall.function.name === "search_documentation") {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                
                if (!writeSSE("tool_start", { 
                  tool: "search_documentation", 
                  query: args.query,
                  timestamp: new Date().toISOString()
                })) return;

                const results = await this.searchDocumentation(args.query);
                
                if (!writeSSE("tool_result", { 
                  tool: "search_documentation", 
                  results,
                  timestamp: new Date().toISOString()
                })) return;

                // Add tool result to conversation
                currentMessages.push({
                  role: "tool",
                  content: JSON.stringify(results),
                  tool_call_id: toolCall.id
                });

              } catch (error) {
                console.error("❌ Tool execution error:", error);
                
                if (!writeSSE("error", { 
                  error: "Tool execution failed",
                  details: error instanceof Error ? error.message : "Unknown error",
                  timestamp: new Date().toISOString()
                })) return;
              }
            }
          }

          // Continue to next iteration for tool response
          continue;
        }

        // If no tool calls, we're done
        currentMessages.push({
          role: "assistant",
          content: assistantMessage
        });

        console.log("✅ Agent processing completed successfully");
        break;
      }

      // Send final completion
      if (!writeSSE("done", { 
        message: "Stream completed",
        timestamp: new Date().toISOString()
      })) return;

    } catch (error) {
      console.error("❌ Error in processMessageStream:", error);
      
      if (!isConnectionClosed()) {
        writeSSE("error", { 
          error: "Processing failed",
          details: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Get tool registry instance
   */
  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
