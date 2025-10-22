/**
 * Tool Registry for Agentic System
 * Manages tools that agents can use to perform actions
 */

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (args: Record<string, any>) => Promise<any>;
}

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, Tool> = new Map();

  private constructor() {}

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  /**
   * Register a new tool
   */
  public registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
    console.log(`✅ Registered tool: ${tool.name}`);
  }

  /**
   * Get a tool by name
   */
  public getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  public getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool by name
   */
  public async executeTool(
    name: string,
    args: Record<string, any>
  ): Promise<any> {
    const tool = this.getTool(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found in registry`);
    }

    console.log(`🔧 Executing tool: ${name} with args:`, args);
    return await tool.execute(args);
  }

  /**
   * Get tools in OpenAI function format
   */
  public getToolsForOpenAI(): any[] {
    return this.getAllTools().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: tool.parameters.reduce((acc, param) => {
            acc[param.name] = {
              type: param.type,
              description: param.description,
            };
            return acc;
          }, {} as Record<string, any>),
          required: tool.parameters
            .filter((p) => p.required)
            .map((p) => p.name),
        },
      },
    }));
  }

  /**
   * Clear all tools (useful for testing)
   */
  public clear(): void {
    this.tools.clear();
  }
}
