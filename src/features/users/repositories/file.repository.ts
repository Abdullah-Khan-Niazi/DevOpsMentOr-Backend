import { db } from '../../../app/database';
import { files } from '../../../app/database/schema';

export interface FileRecordInput {
  userId: number;
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mimeType: string;
  fileHash: string;
  isPublic: boolean;
  uploadIp: string | null;
}

export interface FileRecord {
  fileId: number;
  userId: number;
  fileName: string;
  filePath: string;
}

export interface IFileRepository {
  create(input: FileRecordInput): Promise<FileRecord>;
}

export class FileRepository implements IFileRepository {
  async create(input: FileRecordInput): Promise<FileRecord> {
    const inserted = await db.insert(files).values({
      userId: input.userId,
      fileName: input.fileName,
      filePath: input.filePath,
      fileSizeBytes: input.fileSizeBytes,
      mimeType: input.mimeType,
      fileHash: input.fileHash,
      storageType: 'local',
      isPublic: input.isPublic,
      uploadIp: input.uploadIp,
    });

    const fileId = inserted[0]?.insertId;
    if (!fileId) {
      throw new Error('File record insert failed.');
    }

    return {
      fileId,
      userId: input.userId,
      fileName: input.fileName,
      filePath: input.filePath,
    };
  }
}

export const fileRepository = new FileRepository();