/**
 * Business object for codec distribution data
 */
export class CodecDistributionBO {
  constructor(
    public readonly codec: string,
    public readonly count: number,
    public readonly percentage: number
  ) {}

  static fromDto(dto: { codec: string; count: number; percentage: number }): CodecDistributionBO {
    return new CodecDistributionBO(dto.codec, dto.count, dto.percentage);
  }
}
