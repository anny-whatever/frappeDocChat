import OpenAI from "openai";
import dotenv from "dotenv";
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
   * Sanitize tool outputs before adding them to history to avoid bloating context.
   * Keeps essential fields and truncates large text fields.
   */
  private sanitizeToolResult(raw: any): any {
    try {
      const clone = JSON.parse(JSON.stringify(raw));
      // If results array present (from RAG), map to lightweight entries
      if (Array.isArray(clone?.results)) {
        const perContentLimit = 1200; // chars per item
        clone.results = clone.results.map((r: any) => ({
          id: r.id,
          title: r.title,
          similarity: r.similarity,
          sourceUrl: r.sourceUrl,
          // keep a concise snippet only
          content:
            typeof r.content === "string"
              ? r.content.slice(0, perContentLimit)
              : undefined,
          metadata: r.metadata ? { ...r.metadata } : undefined,
        }));
      }
      // If top-level content is very large string, truncate
      if (typeof clone?.content === "string" && clone.content.length > 2000) {
        clone.content = clone.content.slice(0, 2000);
      }
      return clone;
    } catch {
      return raw;
    }
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
   * Process a user message through the agentic workflow with streaming
   * Uses proper OpenAI streaming and SSE format
   */
  async processMessageStream(
    userMessage: string,
    conversationHistory: Message[] = [],
    res: any,
    onConnectionClosed: () => boolean
  ): Promise<void> {
    let isConnectionClosed = false;

    // Helper function to write SSE data
    const writeSSE = (event: string, data: any): boolean => {
      if (isConnectionClosed || onConnectionClosed()) {
        console.log("🛑 Connection closed, skipping SSE write");
        return false;
      }
      
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        return true;
      } catch (error) {
        console.error("SSE write error:", error);
        isConnectionClosed = true;
        return false;
      }
    };

    try {
      console.log(`\n🤖 Processing message (streaming): "${userMessage}"`);

      // Send initial status
      if (!writeSSE('status', { message: 'Starting agent processing...' })) return;

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

      // Create basic query variations immediately (no API call)
      if (!writeSSE('status', { message: 'Preparing search queries...' })) return;
      const expandedQueries = [
        userMessage,
        `What is ${userMessage.toLowerCase()}?`,
        `How to ${userMessage.toLowerCase()}`,
        `${userMessage} guide`,
        `${userMessage} documentation`
      ].filter((q, i, arr) => arr.indexOf(q) === i); // Remove duplicates
      if (!writeSSE('status', { message: 'Search queries prepared' })) return;

      const allToolCalls: any[] = [];
      let iterations = 0;
      const MAX_ITERATIONS = 5;

      // Agent loop - keep calling tools until agent responds with text
      while (iterations < MAX_ITERATIONS) {
        iterations++;
        console.log(`🔄 Agent iteration ${iterations}`);

        if (isConnectionClosed || onConnectionClosed()) return;

        if (!writeSSE('status', { message: `Starting iteration ${iterations}...` })) return;

        // Create streaming completion
        const stream = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: messages as any[],
          tools: this.toolRegistry.getToolsForOpenAI(),
          tool_choice: "auto",
          temperature: 0.7,
          max_tokens: AgentService.OUTPUT_TOKEN_BUDGET,
          stream: true,
        });

        let assistantMessage: any = { 
          role: "assistant", 
          content: "", 
          tool_calls: [] 
        };

        // Process the streaming response
        for await (const chunk of stream) {
          if (isConnectionClosed || onConnectionClosed()) {
            console.log("🛑 Connection closed during OpenAI stream");
            return;
          }

          const delta = chunk.choices[0]?.delta;
          
          // Stream content tokens
          if (delta?.content) {
            assistantMessage.content += delta.content;
            if (!writeSSE('token', { content: delta.content })) return;
          }

          // Handle tool calls
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              if (toolCallDelta.index !== undefined) {
                // Initialize tool call if not exists
                if (!assistantMessage.tool_calls[toolCallDelta.index]) {
                  assistantMessage.tool_calls[toolCallDelta.index] = {
                    id: toolCallDelta.id || "",
                    type: "function",
                    function: { name: "", arguments: "" }
                  };
                }
                
                const toolCall = assistantMessage.tool_calls[toolCallDelta.index];
                if (toolCallDelta.id) toolCall.id = toolCallDelta.id;
                if (toolCallDelta.function?.name) toolCall.function.name += toolCallDelta.function.name;
                if (toolCallDelta.function?.arguments) toolCall.function.arguments += toolCallDelta.function.arguments;
              }
            }
          }
        }

        // Add assistant message to conversation
        messages.push(assistantMessage as Message);

        // If no tool calls, we're done
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
          console.log(`✅ Agent completed with ${iterations} iterations - no more tool calls`);
          
          if (!writeSSE('status', { message: 'Agent processing completed' })) return;
          
          // Send final metadata
          if (!writeSSE('meta', { 
            toolCalls: allToolCalls,
            timestamp: new Date().toISOString(),
            iterations: iterations
          })) return;

          // Send completion signal
          if (!writeSSE('done', { 
            conversationHistory: messages,
            finalResponse: assistantMessage.content || "I apologize, but I was unable to generate a response."
          })) return;

          return;
        }

        // Execute tool calls
        if (!writeSSE('status', { message: `Executing ${assistantMessage.tool_calls.length} tool(s)...` })) return;

        for (const toolCall of assistantMessage.tool_calls) {
          if (isConnectionClosed || onConnectionClosed()) return;

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

            if (!writeSSE('tool_start', { 
              toolName: toolCall.function.name,
              toolId: toolCall.id
            })) return;

            const toolResult = await this.toolRegistry.executeTool(
              toolCall.function.name,
              args
            );

            if (isConnectionClosed || onConnectionClosed()) return;

            if (!writeSSE('tool_result', { 
              toolName: toolCall.function.name,
              toolId: toolCall.id,
              success: true 
            })) return;

            // Add tool response to conversation
            messages.push({
              role: "tool",
              content: JSON.stringify(this.sanitizeToolResult(toolResult)),
              tool_call_id: toolCall.id,
            });

          } catch (error) {
            console.error(`Error executing tool ${toolCall.function.name}:`, error);
            
            if (!writeSSE('tool_result', { 
              toolName: toolCall.function.name,
              toolId: toolCall.id,
              success: false,
              error: error instanceof Error ? error.message : "Unknown error"
            })) return;

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
      }

      // Max iterations reached
      if (iterations >= MAX_ITERATIONS) {
        console.warn("⚠️ Max iterations reached");
        if (!writeSSE('warning', { message: 'Max iterations reached' })) return;
        
        if (!writeSSE('done', { 
          conversationHistory: messages,
          finalResponse: "I apologize, but I reached the maximum number of iterations while processing your request."
        })) return;
      }

    } catch (error) {
      console.error("Agent streaming error:", error);
      if (!isConnectionClosed && !onConnectionClosed()) {
        writeSSE('error', { 
          error: `Agent processing failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }` 
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
