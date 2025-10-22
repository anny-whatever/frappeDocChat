import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();

export interface ConversationData {
  id?: string;
  title?: string;
  userId?: string;
  metadata?: any;
}

export interface MessageData {
  id?: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "function" | "tool";
  content?: string | null;
  name?: string;
  toolCalls?: any;
  toolCallId?: string;
  metadata?: any;
}

export interface ConversationWithMessages {
  id: string;
  title?: string | null;
  userId?: string | null;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
  messages: MessageData[];
}

export class ConversationService {
  private static instance: ConversationService;

  private constructor() {}

  static getInstance(): ConversationService {
    if (!ConversationService.instance) {
      ConversationService.instance = new ConversationService();
    }
    return ConversationService.instance;
  }

  /**
   * Create a new conversation
   */
  async createConversation(data: ConversationData = {}): Promise<ConversationWithMessages> {
    try {
      const conversation = await prisma.conversation.create({
        data: {
          id: data.id || uuidv4(),
          title: data.title,
          userId: data.userId,
          metadata: data.metadata,
        },
        include: {
          messages: {
            orderBy: {
              createdAt: 'asc'
            }
          }
        }
      });

      return this.formatConversation(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      throw new Error("Failed to create conversation");
    }
  }

  /**
   * Get conversation by ID with all messages
   */
  async getConversation(conversationId: string): Promise<ConversationWithMessages | null> {
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            orderBy: {
              createdAt: 'asc'
            }
          }
        }
      });

      if (!conversation) {
        return null;
      }

      return this.formatConversation(conversation);
    } catch (error) {
      console.error("Error fetching conversation:", error);
      throw new Error("Failed to fetch conversation");
    }
  }

  /**
   * Get all conversations for a user (or all if no userId provided)
   */
  async getConversations(userId?: string, limit: number = 50): Promise<ConversationWithMessages[]> {
    try {
      const conversations = await prisma.conversation.findMany({
        where: userId ? { userId } : {},
        include: {
          messages: {
            orderBy: {
              createdAt: 'asc'
            }
          }
        },
        orderBy: {
          updatedAt: 'desc'
        },
        take: limit
      });

      return conversations.map(conv => this.formatConversation(conv));
    } catch (error) {
      console.error("Error fetching conversations:", error);
      throw new Error("Failed to fetch conversations");
    }
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(messageData: MessageData): Promise<MessageData> {
    try {
      const message = await prisma.message.create({
        data: {
          id: messageData.id || uuidv4(),
          conversationId: messageData.conversationId,
          role: messageData.role,
          content: messageData.content,
          name: messageData.name,
          toolCalls: messageData.toolCalls,
          toolCallId: messageData.toolCallId,
          metadata: messageData.metadata,
        }
      });

      // Update conversation's updatedAt timestamp
      await prisma.conversation.update({
        where: { id: messageData.conversationId },
        data: { updatedAt: new Date() }
      });

      return this.formatMessage(message);
    } catch (error) {
      console.error("Error adding message:", error);
      throw new Error("Failed to add message");
    }
  }

  /**
   * Add multiple messages to a conversation (for batch operations)
   */
  async addMessages(messages: MessageData[]): Promise<MessageData[]> {
    try {
      const createdMessages = await prisma.$transaction(async (tx) => {
        const results = [];
        
        for (const messageData of messages) {
          const message = await tx.message.create({
            data: {
              id: messageData.id || uuidv4(),
              conversationId: messageData.conversationId,
              role: messageData.role,
              content: messageData.content,
              name: messageData.name,
              toolCalls: messageData.toolCalls,
              toolCallId: messageData.toolCallId,
              metadata: messageData.metadata,
            }
          });
          results.push(message);
        }

        // Update conversation's updatedAt timestamp
        if (messages.length > 0) {
          await tx.conversation.update({
            where: { id: messages[0].conversationId },
            data: { updatedAt: new Date() }
          });
        }

        return results;
      });

      return createdMessages.map(msg => this.formatMessage(msg));
    } catch (error) {
      console.error("Error adding messages:", error);
      throw new Error("Failed to add messages");
    }
  }

  /**
   * Update conversation title
   */
  async updateConversationTitle(conversationId: string, title: string): Promise<ConversationWithMessages> {
    try {
      const updatedConversation = await prisma.conversation.update({
        where: { id: conversationId },
        data: { title, updatedAt: new Date() },
        include: {
          messages: {
            orderBy: {
              createdAt: 'asc'
            }
          }
        }
      });
      
      return this.formatConversation(updatedConversation);
    } catch (error) {
      console.error("Error updating conversation title:", error);
      throw new Error("Failed to update conversation title");
    }
  }

  /**
   * Delete a conversation and all its messages
   */
  async deleteConversation(conversationId: string): Promise<void> {
    try {
      await prisma.conversation.delete({
        where: { id: conversationId }
      });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      throw new Error("Failed to delete conversation");
    }
  }

  /**
   * Get conversation messages in LangChain format
   */
  async getConversationHistory(conversationId: string): Promise<Array<{
    role: string;
    content: string | null;
    name?: string;
    tool_calls?: any;
    tool_call_id?: string;
  }>> {
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation) {
        return [];
      }

      return conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content || null,
        name: msg.name,
        tool_calls: msg.toolCalls,
        tool_call_id: msg.toolCallId,
      }));
    } catch (error) {
      console.error("Error getting conversation history:", error);
      return [];
    }
  }

  /**
   * Generate a title for a conversation based on the first user message
   */
  async generateConversationTitle(conversationId: string): Promise<string> {
    try {
      const conversation = await this.getConversation(conversationId);
      if (!conversation || conversation.messages.length === 0) {
        return "New Conversation";
      }

      const firstUserMessage = conversation.messages.find(msg => msg.role === "user");
      if (!firstUserMessage || !firstUserMessage.content) {
        return "New Conversation";
      }

      // Generate a title from the first user message (truncate if too long)
      const title = firstUserMessage.content.slice(0, 50);
      return title.length < firstUserMessage.content.length ? `${title}...` : title;
    } catch (error) {
      console.error("Error generating conversation title:", error);
      return "New Conversation";
    }
  }

  /**
   * Format conversation data for API responses
   */
  private formatConversation(conversation: any): ConversationWithMessages {
    return {
      id: conversation.id,
      title: conversation.title,
      userId: conversation.userId,
      metadata: conversation.metadata,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((msg: any) => this.formatMessage(msg))
    };
  }

  /**
   * Format message data for API responses
   */
  private formatMessage(message: any): MessageData {
    return {
      id: message.id,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content,
      name: message.name,
      toolCalls: message.toolCalls,
      toolCallId: message.toolCallId,
      metadata: message.metadata,
    };
  }
}

export default ConversationService;