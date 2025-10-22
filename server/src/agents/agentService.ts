import OpenAI from "openai";
import dotenv from "dotenv";
import { ToolRegistry } from "./toolRegistry.js";
import { createRagTool, expandQuery } from "./tools/ragTool.js";

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
   * Process a user message through the agentic workflow
   */
  async processMessage(
    userMessage: string,
    conversationHistory: Message[] = []
  ): Promise<AgentResponse> {
    try {
      console.log(`\n🤖 Processing message: "${userMessage}"`);

      // Build conversation with system prompt
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
        ...conversationHistory,
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
        max_tokens: 2000,
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
              content: JSON.stringify(toolResult),
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
          max_tokens: 10000,
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
   * Get tool registry instance
   */
  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
