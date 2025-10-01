import { FileInfoModel } from '../models/file-info.model';

export class FileInfoBo {
  filePath: string;
  fileName: string;
  sizeGb: number;
  codec: string;
  bitrateMbps: number;

  constructor(model: FileInfoModel) {
    this.filePath = model.file_path;
    this.fileName = model.file_name;
    this.sizeGb = model.size_gb;
    this.codec = model.codec;
    this.bitrateMbps = model.bitrate_mbps;
  }

  get sizeFormatted(): string {
    if (this.sizeGb >= 1) {
      return `${this.sizeGb.toFixed(2)} GB`;
    }
    return `${(this.sizeGb * 1024).toFixed(0)} MB`;
  }

  get bitrateFormatted(): string {
    return `${this.bitrateMbps.toFixed(1)} Mbps`;
  }
}
