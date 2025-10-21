import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface DocumentData {
  filename: string;
  title: string;
  content: string;
  embedding: number[];
  metadata?: any;
}

export interface SearchResult {
  id: string;
  filename: string;
  title: string;
  content: string;
  metadata?: any;
  similarity?: number;
}

export class DatabaseService {
  private static instance: DatabaseService;
  
  private constructor() {}
  
  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  /**
   * Store a document with its embedding in the database
   * @param documentData The document data including embedding
   * @returns Promise<string> The created document ID
   */
  async storeDocument(documentData: DocumentData): Promise<string> {
    try {
      // Use raw SQL to insert with proper vector type
      const embeddingString = `[${documentData.embedding.join(',')}]`;
      
      const result = await prisma.$queryRaw`
        INSERT INTO documents (id, filename, title, content, embedding, metadata, "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid()::text,
          ${documentData.filename},
          ${documentData.title},
          ${documentData.content},
          ${embeddingString}::vector,
          ${JSON.stringify(documentData.metadata || {})}::jsonb,
          NOW(),
          NOW()
        )
        RETURNING id
      ` as any[];
      
      return result[0].id;
    } catch (error) {
      console.error('Error storing document:', error);
      throw new Error('Failed to store document');
    }
  }

  /**
   * Search for similar documents using vector similarity
   * @param queryEmbedding The query embedding vector
   * @param limit Maximum number of results to return
   * @param threshold Similarity threshold (0-1)
   * @returns Promise<SearchResult[]> Array of similar documents
   */
  async searchSimilarDocuments(
    queryEmbedding: number[],
    limit: number = 10,
    threshold: number = 0.3
  ): Promise<SearchResult[]> {
    try {
      const embeddingString = `[${queryEmbedding.join(',')}]`;
      
      // Using raw SQL for vector similarity search with pgvector
      const results = await prisma.$queryRaw`
        SELECT 
          id,
          filename,
          title,
          content,
          metadata,
          1 - (embedding <=> ${embeddingString}::vector) as similarity
        FROM documents
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${embeddingString}::vector
        LIMIT ${limit}
      ` as any[];

      return results
        .filter(result => result.similarity >= threshold)
        .map(result => ({
          id: result.id,
          filename: result.filename,
          title: result.title,
          content: result.content,
          metadata: result.metadata,
          similarity: parseFloat(result.similarity),
        }));
    } catch (error) {
      console.error('Error searching documents:', error);
      throw new Error('Failed to search documents');
    }
  }

  /**
   * Get all documents from the database
   * @returns Promise<SearchResult[]> Array of all documents
   */
  async getAllDocuments(): Promise<SearchResult[]> {
    try {
      const documents = await prisma.document.findMany({
        select: {
          id: true,
          filename: true,
          title: true,
          content: true,
          metadata: true,
        },
      });

      return documents;
    } catch (error) {
      console.error('Error fetching documents:', error);
      throw new Error('Failed to fetch documents');
    }
  }

  /**
   * Check if a document already exists by filename
   * @param filename The filename to check
   * @returns Promise<boolean> True if document exists
   */
  async documentExists(filename: string): Promise<boolean> {
    try {
      const document = await prisma.document.findUnique({
        where: { filename },
      });
      
      return !!document;
    } catch (error) {
      console.error('Error checking document existence:', error);
      return false;
    }
  }

  /**
   * Delete all documents from the database
   * @returns Promise<number> Number of deleted documents
   */
  async clearAllDocuments(): Promise<number> {
    try {
      const result = await prisma.document.deleteMany();
      return result.count;
    } catch (error) {
      console.error('Error clearing documents:', error);
      throw new Error('Failed to clear documents');
    }
  }

  /**
   * Close the database connection
   */
  async disconnect(): Promise<void> {
    await prisma.$disconnect();
    console.log('Database connection closed');
  }
}