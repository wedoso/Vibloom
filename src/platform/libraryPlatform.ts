import type { LibrarySession, LibrarySnapshot, StoredLibrarySnapshot } from "../domain/library";
import type { VocalAnalysisStore } from "../audio/vocals/analysisStore";

export type StorageState = {
  usage: number;
  quota: number;
  persistent: boolean;
};

export interface LibraryRepository {
  load(): Promise<StoredLibrarySnapshot | null>;
  save(snapshot: LibrarySnapshot): Promise<void>;
  saveSession?(session: LibrarySession): Promise<void>;
  reset(): Promise<void>;
}

export interface AudioFileStore {
  get(key: string): Promise<File | null>;
  put(key: string, file: Blob): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface DeviceStorageManager {
  readState(): Promise<StorageState>;
  requestPersistence(): Promise<boolean>;
}

export type LibraryPlatform = {
  repository: LibraryRepository;
  audioFiles: AudioFileStore;
  storage: DeviceStorageManager;
  runtime: "web" | "desktop";
  vocalAnalyses?: VocalAnalysisStore;
};
