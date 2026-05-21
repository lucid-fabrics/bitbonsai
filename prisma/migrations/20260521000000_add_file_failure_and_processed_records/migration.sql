-- CreateTable
CREATE TABLE "file_failure_records" (
    "id" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "contentFingerprint" TEXT,
    "totalFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "autoBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "file_failure_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_file_records" (
    "id" TEXT NOT NULL,
    "contentFingerprint" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "resultCodec" TEXT NOT NULL,
    "savedPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "processed_file_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_failure_records_libraryId_autoBlacklisted_idx" ON "file_failure_records"("libraryId", "autoBlacklisted");

-- CreateIndex
CREATE INDEX "file_failure_records_contentFingerprint_idx" ON "file_failure_records"("contentFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "file_failure_records_filePath_libraryId_key" ON "file_failure_records"("filePath", "libraryId");

-- CreateIndex
CREATE UNIQUE INDEX "processed_file_records_contentFingerprint_key" ON "processed_file_records"("contentFingerprint");

-- CreateIndex
CREATE INDEX "processed_file_records_libraryId_idx" ON "processed_file_records"("libraryId");

-- AddForeignKey
ALTER TABLE "file_failure_records" ADD CONSTRAINT "file_failure_records_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_file_records" ADD CONSTRAINT "processed_file_records_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
