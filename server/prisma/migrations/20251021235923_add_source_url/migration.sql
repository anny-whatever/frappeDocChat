-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "embedding" vector(1536),
    "metadata" JSONB,
    "isChunked" BOOLEAN NOT NULL DEFAULT false,
    "parentDocId" TEXT,
    "chunkIndex" INTEGER,
    "totalChunks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_parentDocId_idx" ON "documents"("parentDocId");

-- CreateIndex
CREATE INDEX "documents_filename_idx" ON "documents"("filename");

-- CreateIndex
CREATE UNIQUE INDEX "documents_filename_chunkIndex_key" ON "documents"("filename", "chunkIndex");
