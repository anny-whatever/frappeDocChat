import { ChatOpenAI } from "@langchain/openai";

export interface SubQuery {
  question: string;
  priority: number; // 1-5, where 5 is highest priority
  category: string; // e.g., "concept", "procedure", "example", "troubleshooting"
}

export interface DecompositionResult {
  originalQuery: string;
  subQueries: SubQuery[];
  isComplex: boolean;
  strategy: "single" | "decomposed" | "hybrid";
}

export class QueryDecompositionService {
  private static instance: QueryDecompositionService;
  private llm: ChatOpenAI;

  private constructor() {
    this.llm = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.1,
      maxTokens: 1000,
    });
  }

  static getInstance(): QueryDecompositionService {
    if (!QueryDecompositionService.instance) {
      QueryDecompositionService.instance = new QueryDecompositionService();
    }
    return QueryDecompositionService.instance;
  }

  /**
   * Analyze if a query is complex and needs decomposition
   */
  private isComplexQuery(query: string): boolean {
    const complexityIndicators = [
      /\b(and|or|but|however|also|additionally|furthermore|moreover)\b/i,
      /\b(how to.*and|step.*step|first.*then|after.*before)\b/i,
      /\b(compare|difference|versus|vs|between.*and)\b/i,
      /\b(multiple|several|various|different|all)\b/i,
      /\?.*\?/, // Multiple question marks
      /\b(explain.*how.*why|what.*when.*where)\b/i,
    ];

    const wordCount = query.split(/\s+/).length;
    const hasComplexIndicators = complexityIndicators.some(pattern => pattern.test(query));
    
    return wordCount > 15 || hasComplexIndicators;
  }

  /**
   * Decompose a complex query into sub-questions
   */
  async decomposeQuery(query: string): Promise<DecompositionResult> {
    const isComplex = this.isComplexQuery(query);
    
    if (!isComplex) {
      return {
        originalQuery: query,
        subQueries: [{
          question: query,
          priority: 5,
          category: "direct"
        }],
        isComplex: false,
        strategy: "single"
      };
    }

    const decompositionPrompt = `
You are an expert at breaking down complex questions about Frappe Framework documentation into smaller, focused sub-questions.

Given this complex query: "${query}"

Break it down into 2-4 focused sub-questions that would help retrieve relevant information from Frappe documentation. Each sub-question should:
1. Be specific and searchable
2. Focus on one concept or procedure
3. Be answerable from documentation

Respond with a JSON object in this exact format:
{
  "subQueries": [
    {
      "question": "specific sub-question here",
      "priority": 1-5,
      "category": "concept|procedure|example|troubleshooting|configuration"
    }
  ]
}

Categories:
- concept: Understanding what something is
- procedure: How to do something step-by-step
- example: Code examples or practical implementations
- troubleshooting: Solving problems or errors
- configuration: Setup or configuration instructions

Priority (1-5): 5 = most important for answering the original query, 1 = least important
`;

    try {
      const response = await this.llm.invoke(decompositionPrompt);
      const content = response.content as string;
      
      // Extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      return {
        originalQuery: query,
        subQueries: parsed.subQueries || [],
        isComplex: true,
        strategy: "decomposed"
      };
    } catch (error) {
      console.error("Error in query decomposition:", error);
      
      // Fallback to simple decomposition
      return {
        originalQuery: query,
        subQueries: [{
          question: query,
          priority: 5,
          category: "direct"
        }],
        isComplex: false,
        strategy: "single"
      };
    }
  }

  /**
   * Generate follow-up questions based on initial search results
   */
  async generateFollowUpQueries(
    originalQuery: string,
    searchResults: any[],
    conversationHistory: string[] = []
  ): Promise<SubQuery[]> {
    if (searchResults.length === 0) {
      return [];
    }

    const resultSummary = searchResults
      .slice(0, 3)
      .map(result => `- ${result.title}: ${result.content.substring(0, 200)}...`)
      .join('\n');

    const followUpPrompt = `
Based on the original query: "${originalQuery}"

And these search results:
${resultSummary}

Generate 1-2 follow-up questions that could help find additional relevant information. These should:
1. Address gaps in the current results
2. Seek more specific or detailed information
3. Look for related concepts or procedures

Respond with JSON:
{
  "followUpQueries": [
    {
      "question": "follow-up question here",
      "priority": 1-5,
      "category": "concept|procedure|example|troubleshooting|configuration"
    }
  ]
}
`;

    try {
      const response = await this.llm.invoke(followUpPrompt);
      const content = response.content as string;
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.followUpQueries || [];
    } catch (error) {
      console.error("Error generating follow-up queries:", error);
      return [];
    }
  }
}