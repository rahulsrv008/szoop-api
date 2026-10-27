import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

/** Where the agent is as they set off; without it their last GPS ping is used. */
export class OnTheWayDto {
  @ApiPropertyOptional({ example: 28.6139 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 77.209 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
