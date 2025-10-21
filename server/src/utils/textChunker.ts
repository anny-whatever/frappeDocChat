export interface TextChunk {
  content: string;
  chunkIndex: number;
  totalChunks: number;
}

export class TextChunker {
  private static readonly MAX_TOKENS = 8000; // Leave some buffer below 8192
  private static readonly CHARS_PER_TOKEN = 4; // Rough estimate: 1 token ≈ 4 characters
  private static readonly OVERLAP_TOKENS = 100; // Overlap between chunks for context

  /**
   * Estimate the number of tokens in a text
   * @param text The text to estimate tokens for
   * @returns number Estimated token count
   */
  private static estimateTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Check if text exceeds token limit
   * @param text The text to check
   * @returns boolean True if text exceeds limit
   */
  static needsChunking(text: string): boolean {
    return this.estimateTokens(text) > this.MAX_TOKENS;
  }

  /**
   * Split text into chunks that fit within token limits
   * Tries to split at paragraph boundaries to maintain context
   * @param text The text to chunk
   * @returns TextChunk[] Array of text chunks
   */
  static chunkText(text: string): TextChunk[] {
    const estimatedTokens = this.estimateTokens(text);

    if (!this.needsChunking(text)) {
      return [{ content: text, chunkIndex: 0, totalChunks: 1 }];
    }

    console.log(`Text needs chunking. Estimated tokens: ${estimatedTokens}`);

    const maxChunkChars = this.MAX_TOKENS * this.CHARS_PER_TOKEN;
    const overlapChars = this.OVERLAP_TOKENS * this.CHARS_PER_TOKEN;

    // Split text into paragraphs (double newline)
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const paragraph of paragraphs) {
      const testChunk = currentChunk
        ? `${currentChunk}\n\n${paragraph}`
        : paragraph;

      if (this.estimateTokens(testChunk) <= this.MAX_TOKENS) {
        currentChunk = testChunk;
      } else {
        // Current paragraph would exceed limit
        if (currentChunk) {
          chunks.push(currentChunk);

          // Add overlap from previous chunk
          const words = currentChunk.split(/\s+/);
          const overlapWords = words.slice(-Math.ceil(overlapChars / 5)); // ~5 chars per word
          currentChunk = overlapWords.join(" ") + "\n\n" + paragraph;
        } else {
          // Single paragraph is too large, need to split it further
          const splitParagraph = this.splitLargeParagraph(
            paragraph,
            maxChunkChars,
            overlapChars
          );
          chunks.push(...splitParagraph.slice(0, -1));
          currentChunk = splitParagraph[splitParagraph.length - 1];
        }
      }
    }

    // Add the last chunk
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    // Convert to TextChunk format
    return chunks.map((content, index) => ({
      content,
      chunkIndex: index,
      totalChunks: chunks.length,
    }));
  }

  /**
   * Split a single large paragraph into smaller chunks
   * @param paragraph The paragraph to split
   * @param maxChunkChars Maximum characters per chunk
   * @param overlapChars Overlap characters between chunks
   * @returns string[] Array of paragraph chunks
   */
  private static splitLargeParagraph(
    paragraph: string,
    maxChunkChars: number,
    overlapChars: number
  ): string[] {
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const sentence of sentences) {
      const testChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;

      if (testChunk.length <= maxChunkChars) {
        currentChunk = testChunk;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);

          // Add overlap
          const words = currentChunk.split(/\s+/);
          const overlapWords = words.slice(-Math.ceil(overlapChars / 5));
          currentChunk = overlapWords.join(" ") + " " + sentence;
        } else {
          // Single sentence is too large, split by words
          const words = sentence.split(/\s+/);
          const wordsPerChunk = Math.floor(maxChunkChars / 5);

          for (let i = 0; i < words.length; i += wordsPerChunk) {
            const chunk = words.slice(i, i + wordsPerChunk).join(" ");
            chunks.push(chunk);
          }
          currentChunk = "";
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Get descriptive metadata about chunking
   * @param chunks Array of text chunks
   * @returns object Chunking metadata
   */
  static getChunkingMetadata(chunks: TextChunk[]): object {
    return {
      totalChunks: chunks.length,
      estimatedTokensPerChunk: chunks.map((c) =>
        this.estimateTokens(c.content)
      ),
      avgChunkSize: Math.round(
        chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length
      ),
    };
  }
}
