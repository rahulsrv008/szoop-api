import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export const AGENT_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
export const AGENT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];

/** `search` is inherited from PaginationQueryDto and matches name/mobile/employee ID. */
export class ListAdminAgentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AGENT_APPROVAL_STATUSES })
  @IsOptional()
  @IsIn(AGENT_APPROVAL_STATUSES)
  approvalStatus?: string;

  @ApiPropertyOptional({ enum: AGENT_STATUSES })
  @IsOptional()
  @IsIn(AGENT_STATUSES)
  status?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'createdAt from' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'createdAt to' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
