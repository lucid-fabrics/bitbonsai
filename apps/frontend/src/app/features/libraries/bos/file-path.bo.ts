/**
 * Business Object for file path manipulation and formatting
 * Following SRP: Separates file path logic from components
 */
export class FilePathBo {
  /**
   * Extract filename from full file path
   */
  static getFileName(filePath: string): string {
    return filePath.split('/').pop() || filePath;
  }

  /**
   * Get file extension from path
   */
  static getFileExtension(filePath: string): string {
    const fileName = FilePathBo.getFileName(filePath);
    const lastDot = fileName.lastIndexOf('.');
    return lastDot > 0 ? fileName.substring(lastDot + 1).toLowerCase() : '';
  }

  /**
   * Get directory path from full file path
   */
  static getDirectoryPath(filePath: string): string {
    const parts = filePath.split('/');
    parts.pop();
    return parts.join('/');
  }

  /**
   * Check if path is a video file based on extension
   */
  static isVideoFile(filePath: string): boolean {
    const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'];
    const extension = FilePathBo.getFileExtension(filePath);
    return videoExtensions.includes(extension);
  }
}
