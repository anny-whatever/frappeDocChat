import fs from 'fs';
import path from 'path';
import { EmbeddingService } from '../services/embeddingService.js';
import { DatabaseService } from '../services/databaseService.js';

const SCRAPED_DOCS_DIR = path.join(process.cwd(), 'scraped_docs');

interface DocumentInfo {
  filename: string;
  title: string;
  content: string;
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
    // Remove .txt extension and replace underscores/hyphens with spaces
    return filename
      .replace('.txt', '')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Read and parse a single document file
   * @param filePath Path to the document file
   * @returns DocumentInfo | null
   */
  private async readDocument(filePath: string): Promise<DocumentInfo | null> {
    try {
      const filename = path.basename(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      // Skip empty files
      if (!content.trim()) {
        console.log(`Skipping empty file: ${filename}`);
        return null;
      }

      const title = this.extractTitle(filename);
      
      return {
        filename,
        title,
        content: content.trim(),
      };
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Process a single document: generate embedding and store in database
   * @param document The document to process
   */
  private async processDocument(document: DocumentInfo): Promise<void> {
    try {
      // Check if document already exists
      const exists = await this.databaseService.documentExists(document.filename);
      if (exists) {
        console.log(`Document already exists, skipping: ${document.filename}`);
        return;
      }

      console.log(`Processing document: ${document.filename}`);
      
      // Generate embedding for the document content
      const embedding = await this.embeddingService.generateEmbedding(document.content);
      
      // Store document with embedding in database
      await this.databaseService.storeDocument({
        filename: document.filename,
        title: document.title,
        content: document.content,
        embedding,
        metadata: {
          processedAt: new Date().toISOString(),
          contentLength: document.content.length,
        },
      });

      console.log(`Successfully processed: ${document.filename}`);
    } catch (error) {
      console.error(`Error processing document ${document.filename}:`, error);
    }
  }

  /**
   * Process all documents in the scraped_docs directory
   */
  async processAllDocuments(): Promise<void> {
    try {
      console.log('Starting document processing...');
      
      // Check if scraped_docs directory exists
      if (!fs.existsSync(SCRAPED_DOCS_DIR)) {
        console.error(`Scraped docs directory not found: ${SCRAPED_DOCS_DIR}`);
        return;
      }

      // Get all .txt files from the directory
      const files = fs.readdirSync(SCRAPED_DOCS_DIR)
        .filter(file => file.endsWith('.txt'))
        .map(file => path.join(SCRAPED_DOCS_DIR, file));

      console.log(`Found ${files.length} document files to process`);

      let processed = 0;
      let skipped = 0;
      let errors = 0;

      // Process documents in batches to avoid rate limits
      const batchSize = 5;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(files.length / batchSize)}`);
        
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
          console.log('Waiting 2 seconds before next batch...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      console.log('\n=== Processing Summary ===');
      console.log(`Total files found: ${files.length}`);
      console.log(`Successfully processed: ${processed}`);
      console.log(`Skipped: ${skipped}`);
      console.log(`Errors: ${errors}`);
      console.log('Document processing completed!');

    } catch (error) {
      console.error('Error in document processing:', error);
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