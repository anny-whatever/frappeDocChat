import fs from "fs";
import path from "path";
import { EmbeddingService } from "../services/embeddingService.js";
import { DatabaseService } from "../services/databaseService.js";
import { TextChunker } from "../utils/textChunker.js";

const SCRAPED_DOCS_DIR = path.join(process.cwd(), "scraped_docs");

interface DocumentInfo {
  filename: string;
  title: string;
  content: string;
  sourceUrl?: string;
}

class DocumentProcessor {
  private embeddingService: EmbeddingService;
  private databaseService: DatabaseService;

  constructor() {
    this.embeddingService = EmbeddingService.getInstance();
    this.databaseService = DatabaseService.getInstance();
  }

  /**
   * Extract title from filename
   * @param filename The filename to extract title from
   * @returns string The extracted title
   */
  private extractTitle(filename: string): string {
    // Remove .txt or .json extension and replace underscores/hyphens with spaces
    return filename
      .replace(/\.(txt|json)$/, "")
      .replace(/[_-]/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
  }

  /**
   * Read and parse a single document file
   * @param filePath Path to the document file
   * @returns DocumentInfo | null
   */
  private async readDocument(filePath: string): Promise<DocumentInfo | null> {
    try {
      const filename = path.basename(filePath);
      const fileContent = fs.readFileSync(filePath, "utf-8");

      // Skip empty files
      if (!fileContent.trim()) {
        console.log(`Skipping empty file: ${filename}`);
        return null;
      }

      let documentData: any;
      let content: string;
      let title: string;
      let sourceUrl: string | undefined;

      // Check if file is JSON format (new format) or plain text (old format)
      if (filename.endsWith('.json')) {
        try {
          documentData = JSON.parse(fileContent);
          content = documentData.content || '';
          title = documentData.title || this.extractTitle(filename);
          sourceUrl = documentData.sourceUrl;
        } catch (parseError) {
          console.error(`Error parsing JSON file ${filename}:`, parseError);
          return null;
        }
      } else {
        // Legacy text format
        content = fileContent.trim();
        title = this.extractTitle(filename);
        sourceUrl = undefined;
      }

      return {
        filename,
        title,
        content,
        sourceUrl,
      };
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Process a single document: generate embedding and store in database
   * Handles chunking for large documents automatically
   * @param document The document to process
   */
  private async processDocument(document: DocumentInfo): Promise<void> {
    try {
      // Check if document already exists
      const exists = await this.databaseService.documentExists(
        document.filename
      );
      if (exists) {
        console.log(`Document already exists, skipping: ${document.filename}`);
        return;
      }

      console.log(`Processing document: ${document.filename}`);

      // Check if document needs chunking
      if (TextChunker.needsChunking(document.content)) {
        console.log(
          `Document exceeds token limit, chunking: ${document.filename}`
        );
        await this.processChunkedDocument(document);
      } else {
        await this.processSingleDocument(document);
      }

      console.log(`Successfully processed: ${document.filename}`);
    } catch (error) {
      console.error(`Error processing document ${document.filename}:`, error);
    }
  }

  /**
   * Process a document that fits within token limits
   * @param document The document to process
   */
  private async processSingleDocument(document: DocumentInfo): Promise<void> {
    // Generate embedding for the document content
    const embedding = await this.embeddingService.generateEmbedding(
      document.content
    );

    // Store document with embedding in database
    await this.databaseService.storeDocument({
      filename: document.filename,
      title: document.title,
      content: document.content,
      embedding,
      isChunked: false,
      sourceUrl: document.sourceUrl,
      metadata: {
        processedAt: new Date().toISOString(),
        contentLength: document.content.length,
      },
    });
  }

  /**
   * Process a large document by splitting it into chunks
   * @param document The document to chunk and process
   */
  private async processChunkedDocument(document: DocumentInfo): Promise<void> {
    // Split document into chunks
    const chunks = TextChunker.chunkText(document.content);
    console.log(`Split into ${chunks.length} chunks`);

    // Store parent document metadata (without embedding)
    const parentDocId = await this.databaseService.storeDocument({
      filename: document.filename,
      title: document.title,
      content: `[Chunked Document - ${chunks.length} parts]`,
      embedding: new Array(1536).fill(0), // Placeholder embedding
      isChunked: true,
      totalChunks: chunks.length,
      metadata: {
        processedAt: new Date().toISOString(),
        contentLength: document.content.length,
        chunkingInfo: TextChunker.getChunkingMetadata(chunks),
      },
    });

    // Process each chunk
    for (const chunk of chunks) {
      // Check if this specific chunk already exists
      const chunkExists = await this.databaseService.documentChunkExists(
        document.filename,
        chunk.chunkIndex
      );

      if (chunkExists) {
        console.log(
          `Chunk ${chunk.chunkIndex + 1}/${
            chunks.length
          } already exists, skipping`
        );
        continue;
      }

      console.log(`Processing chunk ${chunk.chunkIndex + 1}/${chunks.length}`);

      // Generate embedding for the chunk
      const embedding = await this.embeddingService.generateEmbedding(
        chunk.content
      );

      // Store chunk with embedding
      await this.databaseService.storeDocument({
        filename: document.filename,
        title: `${document.title} (Part ${chunk.chunkIndex + 1}/${
          chunks.length
        })`,
        content: chunk.content,
        embedding,
        isChunked: true,
        parentDocId,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunks.length,
        sourceUrl: document.sourceUrl,
        metadata: {
          processedAt: new Date().toISOString(),
          contentLength: chunk.content.length,
          isChunk: true,
        },
      });
    }
  }

  /**
   * Process all documents in the scraped_docs directory
   */
  async processAllDocuments(): Promise<void> {
    try {
      console.log("Starting document processing...");

      // Check if scraped_docs directory exists
      if (!fs.existsSync(SCRAPED_DOCS_DIR)) {
        console.error(`Scraped docs directory not found: ${SCRAPED_DOCS_DIR}`);
        return;
      }

      // Get all .txt and .json files from the directory
      const files = fs
        .readdirSync(SCRAPED_DOCS_DIR)
        .filter((file) => file.endsWith(".txt") || file.endsWith(".json"))
        .map((file) => path.join(SCRAPED_DOCS_DIR, file));

      console.log(`Found ${files.length} document files to process`);

      let processed = 0;
      let skipped = 0;
      let errors = 0;

      // Process documents in batches to avoid rate limits
      const batchSize = 2;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        console.log(
          `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            files.length / batchSize
          )}`
        );

        const batchPromises = batch.map(async (filePath) => {
          try {
            const document = await this.readDocument(filePath);
            if (document) {
              await this.processDocument(document);
              processed++;
            } else {
              skipped++;
            }
          } catch (error) {
            console.error(`Error in batch processing for ${filePath}:`, error);
            errors++;
          }
        });

        await Promise.all(batchPromises);

        // Add delay between batches to respect rate limits
        if (i + batchSize < files.length) {
          console.log("Waiting 2 seconds before next batch...");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      console.log("\n=== Processing Summary ===");
      console.log(`Total files found: ${files.length}`);
      console.log(`Successfully processed: ${processed}`);
      console.log(`Skipped: ${skipped}`);
      console.log(`Errors: ${errors}`);
      console.log("Document processing completed!");
    } catch (error) {
      console.error("Error in document processing:", error);
    } finally {
      await this.databaseService.disconnect();
    }
  }
}

// Run the document processor if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const processor = new DocumentProcessor();
  processor.processAllDocuments().catch(console.error);
}
