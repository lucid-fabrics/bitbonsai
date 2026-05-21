export interface FileInfoModel {
  file_path: string;
  file_name: string;
  size_gb: number;
  codec: string;
  bitrate_mbps: number;
}

export interface FolderFilesModel {
  folder_name: string;
  folder_path: string;
  codec: string;
  total_files: number;
  files: FileInfoModel[];
}
