import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for library scan operation
 */
export class ScanJobsResponseDto {
  @ApiProperty({
    description: 'Number of jobs created from scan',
    example: 42,
  })
  jobsCreated!: number;

  @ApiProperty({
    description: 'Array of created job objects',
    type: 'array',
    example: [
      {
        id: 'clq8x9z8x0000qh8x9z8x0000',
        filePath: '/mnt/media/movies/movie1.mkv',
        stage: 'QUEUED',
      },
    ],
  })
  jobs!: Array<{
    id: string;
    filePath: string;
    stage: string;
    [key: string]: unknown;
  }>;
}
