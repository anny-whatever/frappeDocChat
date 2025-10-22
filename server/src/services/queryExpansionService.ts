import { ChatOpenAI } from "@langchain/openai";

export interface ExpandedQuery {
  original: string;
  expanded: string;
  type: "synonym" | "technical" | "conceptual" | "procedural" | "contextual";
  confidence: number; // 0-1
}

export interface QueryExpansionResult {
  originalQuery: string;
  expandedQueries: ExpandedQuery[];
  keywords: string[];
  technicalTerms: string[];
}

export class QueryExpansionService {
  private static instance: QueryExpansionService;
  private llm: ChatOpenAI;

  // Frappe-specific terminology mapping
  private frappeTerms = new Map([
    ["form", ["doctype", "document", "form view", "desk form"]],
    ["list", ["listview", "list view", "report", "data table"]],
    ["field", ["docfield", "form field", "document field", "field type"]],
    ["script", ["client script", "server script", "custom script", "js script"]],
    ["hook", ["hooks.py", "app hooks", "frappe hooks", "event hooks"]],
    ["api", ["rest api", "server api", "frappe api", "web api"]],
    ["database", ["db", "mariadb", "mysql", "database query"]],
    ["permission", ["role", "user permission", "document permission", "access control"]],
    ["workflow", ["workflow state", "workflow action", "approval workflow"]],
    ["report", ["query report", "script report", "report builder", "custom report"]],
    ["print", ["print format", "pdf", "print template", "document printing"]],
    ["email", ["email template", "notification", "email alert", "communication"]],
    ["custom", ["customization", "customize", "custom field", "custom doctype"]],
    ["bench", ["frappe bench", "bench command", "site management"]],
    ["app", ["frappe app", "application", "custom app", "app development"]],
    ["site", ["frappe site", "multi-tenant", "site configuration"]],
    ["migration", ["database migration", "schema migration", "data migration"]],
    ["translation", ["language", "locale", "internationalization", "i18n"]],
  ]);

  private constructor() {
    this.llm = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 800,
    });
  }

  static getInstance(): QueryExpansionService {
    if (!QueryExpansionService.instance) {
      QueryExpansionService.instance = new QueryExpansionService();
    }
    return QueryExpansionService.instance;
  }

  /**
   * Extract Frappe-specific terms and their variations
   */
  private extractFrappeTerms(query: string): string[] {
    const queryLower = query.toLowerCase();
    const foundTerms: string[] = [];

    for (const [key, variations] of this.frappeTerms) {
      if (queryLower.includes(key)) {
        foundTerms.push(...variations);
      }
      
      // Check if any variation is in the query
      for (const variation of variations) {
        if (queryLower.includes(variation.toLowerCase())) {
          foundTerms.push(key, ...variations.filter(v => v !== variation));
          break;
        }
      }
    }

    return [...new Set(foundTerms)];
  }

  /**
   * Generate keyword variations using simple rules
   */
  private generateKeywordVariations(query: string): string[] {
    const words = query.toLowerCase().split(/\s+/);
    const variations: string[] = [];

    // Add plural/singular variations
    words.forEach(word => {
      if (word.endsWith('s') && word.length > 3) {
        variations.push(word.slice(0, -1)); // Remove 's'
      } else if (!word.endsWith('s')) {
        variations.push(word + 's'); // Add 's'
      }
      
      // Add common programming variations
      if (word.includes('_')) {
        variations.push(word.replace(/_/g, ' '));
        variations.push(word.replace(/_/g, ''));
      }
      
      if (word.includes('-')) {
        variations.push(word.replace(/-/g, ' '));
        variations.push(word.replace(/-/g, ''));
      }
    });

    return [...new Set(variations)];
  }

  /**
   * Expand a query using LLM for semantic expansion
   */
  async expandQueryWithLLM(query: string): Promise<ExpandedQuery[]> {
    const expansionPrompt = `
You are an expert in Frappe Framework documentation. Given a user query, generate 3-4 alternative ways to express the same question that would help find relevant documentation.

Original query: "${query}"

Generate variations that:
1. Use different technical terminology
2. Rephrase the question structure
3. Add context about Frappe Framework
4. Use synonyms and related concepts

Respond with JSON:
{
  "expansions": [
    {
      "expanded": "alternative query here",
      "type": "synonym|technical|conceptual|procedural|contextual",
      "confidence": 0.8
    }
  ]
}

Types:
- synonym: Using different words with same meaning
- technical: Using more technical Frappe terminology
- conceptual: Focusing on the underlying concept
- procedural: Focusing on the process/steps
- contextual: Adding Frappe-specific context
`;

    try {
      const response = await this.llm.invoke(expansionPrompt);
      const content = response.content as string;
      
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return (parsed.expansions || []).map((exp: any) => ({
        original: query,
        expanded: exp.expanded,
        type: exp.type,
        confidence: exp.confidence || 0.5
      }));
    } catch (error) {
      console.error("Error in LLM query expansion:", error);
      return [];
    }
  }

  /**
   * Main method to expand a query
   */
  async expandQuery(query: string): Promise<QueryExpansionResult> {
    // Get Frappe-specific terms
    const frappeTerms = this.extractFrappeTerms(query);
    
    // Get keyword variations
    const keywordVariations = this.generateKeywordVariations(query);
    
    // Get LLM-based expansions
    const llmExpansions = await this.expandQueryWithLLM(query);
    
    // Create rule-based expansions
    const ruleBasedExpansions: ExpandedQuery[] = [];
    
    // Add Frappe term variations
    if (frappeTerms.length > 0) {
      const frappeVariation = query + " " + frappeTerms.slice(0, 3).join(" ");
      ruleBasedExpansions.push({
        original: query,
        expanded: frappeVariation,
        type: "technical",
        confidence: 0.7
      });
    }
    
    // Add keyword variations
    if (keywordVariations.length > 0) {
      const keywordVariation = query + " " + keywordVariations.slice(0, 2).join(" ");
      ruleBasedExpansions.push({
        original: query,
        expanded: keywordVariation,
        type: "synonym",
        confidence: 0.6
      });
    }

    // Add context-specific variations
    const contextualExpansions: ExpandedQuery[] = [
      {
        original: query,
        expanded: `frappe framework ${query}`,
        type: "contextual",
        confidence: 0.8
      },
      {
        original: query,
        expanded: `${query} documentation`,
        type: "contextual",
        confidence: 0.7
      }
    ];

    const allExpansions = [
      ...llmExpansions,
      ...ruleBasedExpansions,
      ...contextualExpansions
    ];

    // Remove duplicates and sort by confidence
    const uniqueExpansions = allExpansions
      .filter((exp, index, arr) => 
        arr.findIndex(e => e.expanded.toLowerCase() === exp.expanded.toLowerCase()) === index
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6); // Limit to top 6 expansions

    return {
      originalQuery: query,
      expandedQueries: uniqueExpansions,
      keywords: keywordVariations,
      technicalTerms: frappeTerms
    };
  }

  /**
   * Generate search variations for a specific context
   */
  async generateSearchVariations(
    query: string,
    context: "troubleshooting" | "tutorial" | "api" | "configuration"
  ): Promise<string[]> {
    const contextPrompts = {
      troubleshooting: `error ${query} fix solution problem`,
      tutorial: `how to ${query} step by step guide tutorial`,
      api: `${query} api method function code example`,
      configuration: `${query} setup configure settings configuration`
    };

    const contextualQuery = contextPrompts[context];
    const expansion = await this.expandQuery(contextualQuery);
    
    return [
      contextualQuery,
      ...expansion.expandedQueries.map(eq => eq.expanded)
    ].slice(0, 4);
  }
}