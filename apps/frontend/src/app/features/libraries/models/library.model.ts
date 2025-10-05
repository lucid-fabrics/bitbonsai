export enum MediaType {
  MOVIE = 'MOVIE',
  TV_SHOW = 'TV_SHOW',
  ANIME = 'ANIME',
  ANIME_MOVIE = 'ANIME_MOVIE',
  MIXED = 'MIXED',
  OTHER = 'OTHER',
}

export interface LibraryNode {
  id: string;
  name: string;
  status: string;
}

export interface LibraryPolicy {
  id: string;
  name: string;
  preset: string;
}

export interface LibraryJobCount {
  jobs: number;
}

export interface Library {
  id: string;
  name: string;
  path: string;
  mediaType: MediaType;
  enabled: boolean;
  watchEnabled: boolean;
  lastScanAt: string | null;
  totalFiles: number;
  totalSizeBytes: string;
  node: LibraryNode;
  policies: LibraryPolicy[];
  _count: LibraryJobCount;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLibraryDto {
  name: string;
  path: string;
  mediaType: MediaType;
}

export interface UpdateLibraryDto {
  name?: string;
  path?: string;
  mediaType?: MediaType;
  enabled?: boolean;
  watchEnabled?: boolean;
}
