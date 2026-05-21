import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { CreatePolicyDto } from './dto/create-policy.dto';
import { PolicyDto } from './dto/policy.dto';
import { PolicyStatsDto } from './dto/policy-stats.dto';
import { PresetInfoDto } from './dto/preset-info.dto';
import type { UpdatePolicyDto } from './dto/update-policy.dto';
import { PoliciesService } from './policies.service';

@ApiTags('policies')
@ApiBearerAuth('JWT-auth')
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create encoding policy',
    description:
      'Creates a new encoding policy with specified codec, quality, and device compatibility settings.\n\n' +
      '**Use Cases:**\n' +
      '- Define encoding standards for specific libraries (e.g., "TV Shows", "Movies")\n' +
      '- Set quality targets based on content type (higher CRF for archival content)\n' +
      '- Configure device-specific compatibility profiles\n\n' +
      '**Presets Available:**\n' +
      '- `BALANCED_HEVC` - General-purpose HEVC encoding (CRF 23)\n' +
      '- `FAST_HEVC` - Speed-optimized HEVC (CRF 26)\n' +
      '- `QUALITY_AV1` - Maximum quality AV1 encoding (CRF 28)\n' +
      '- `COPY_IF_COMPLIANT` - Copy streams if already compliant\n' +
      '- `CUSTOM` - Fully customizable parameters\n\n' +
      '**CRF Quality Guide:**\n' +
      '- 18-22: Visually lossless (large files)\n' +
      '- 23-26: High quality (recommended for most content)\n' +
      '- 27-32: Medium quality (acceptable for web streaming)\n' +
      '- 33+: Low quality (not recommended)',
  })
  @ApiCreatedResponse({
    description: 'Policy created successfully',
    type: PolicyDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input data (e.g., CRF out of range, invalid codec)',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while creating policy',
  })
  async create(@Body() createPolicyDto: CreatePolicyDto): Promise<PolicyDto> {
    return this.policiesService.create(createPolicyDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all policies',
    description:
      'Returns all encoding policies ordered by creation date (newest first).\n\n' +
      '**Response includes:**\n' +
      '- Policy configurations (codec, quality, presets)\n' +
      '- Device compatibility profiles\n' +
      '- Advanced FFmpeg settings\n' +
      '- Associated library IDs',
  })
  @ApiOkResponse({
    description: 'Successfully retrieved all policies',
    type: [PolicyDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while retrieving policies',
  })
  async findAll(): Promise<PolicyDto[]> {
    return this.policiesService.findAll();
  }

  @Get('presets')
  @ApiOperation({
    summary: 'List available encoding presets',
    description:
      'Returns all available encoding presets with detailed descriptions and recommended settings.\n\n' +
      '**Presets:**\n' +
      '1. **Balanced HEVC** - Best all-around choice for most libraries\n' +
      '2. **Fast HEVC** - Prioritizes speed, good for large backlogs\n' +
      '3. **Quality AV1** - Future-proof codec with best compression\n' +
      '4. **Copy if Compliant** - Skip re-encoding for already-compliant files\n' +
      '5. **Custom** - Full manual control over encoding parameters',
  })
  @ApiOkResponse({
    description: 'Successfully retrieved preset information',
    type: [PresetInfoDto],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while retrieving presets',
  })
  getPresets(): PresetInfoDto[] {
    return this.policiesService.getPresets();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get policy with statistics',
    description:
      'Returns detailed policy information including job completion statistics.\n\n' +
      '**Additional Data:**\n' +
      '- Total completed jobs using this policy\n' +
      '- Associated library information\n' +
      '- Policy creation and update timestamps',
  })
  @ApiParam({
    name: 'id',
    description: 'Policy unique identifier (CUID)',
    example: 'clxxxx987654321',
  })
  @ApiOkResponse({
    description: 'Successfully retrieved policy with statistics',
    type: PolicyStatsDto,
  })
  @ApiNotFoundResponse({
    description: 'Policy not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while retrieving policy',
  })
  async findOne(@Param('id') id: string): Promise<PolicyStatsDto> {
    return this.policiesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update policy',
    description:
      'Updates an existing encoding policy. All fields are optional.\n\n' +
      '**Use Cases:**\n' +
      '- Adjust quality settings based on encoding results\n' +
      '- Update device compatibility profiles\n' +
      '- Fine-tune FFmpeg flags for better performance\n\n' +
      '**Note:** Changes only affect new jobs. Existing/completed jobs retain original settings.',
  })
  @ApiParam({
    name: 'id',
    description: 'Policy unique identifier (CUID)',
    example: 'clxxxx987654321',
  })
  @ApiOkResponse({
    description: 'Policy updated successfully',
    type: PolicyDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid update data',
  })
  @ApiNotFoundResponse({
    description: 'Policy not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while updating policy',
  })
  async update(
    @Param('id') id: string,
    @Body() updatePolicyDto: UpdatePolicyDto
  ): Promise<PolicyDto> {
    return this.policiesService.update(id, updatePolicyDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete policy',
    description:
      'Permanently deletes an encoding policy.\n\n' +
      '**Important:**\n' +
      '- Cannot delete policies currently in use by jobs\n' +
      '- Completed jobs will retain policy reference for historical data\n' +
      '- This operation cannot be undone',
  })
  @ApiParam({
    name: 'id',
    description: 'Policy unique identifier (CUID)',
    example: 'clxxxx987654321',
  })
  @ApiNoContentResponse({
    description: 'Policy deleted successfully',
  })
  @ApiNotFoundResponse({
    description: 'Policy not found',
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error occurred while deleting policy',
  })
  async remove(@Param('id') id: string): Promise<void> {
    return this.policiesService.remove(id);
  }
}
