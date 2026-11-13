import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const AIRA_SEGMENTS = ['women', 'men', 'bridal', 'spa'] as const;
export const AIRA_ITEM_KINDS = ['package', 'service'] as const;

/** Photos are stored inline as data URLs, the same as customer home tiles. */
const IMAGE_MAX_LENGTH = 2_000_000;
const SLUG = /^[a-z0-9-]+$/;
const SLUG_MESSAGE = 'id may only use lowercase letters, numbers and dashes';

export class CreateAiraGroupDto {
  @ApiProperty({ example: 'waxing' })
  @IsString()
  @Matches(SLUG, { message: SLUG_MESSAGE })
  @MaxLength(40)
  id: string;

  @ApiProperty({ example: 'Waxing Studio' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title: string;

  @ApiPropertyOptional({ example: 'Rica, honey, roll-on and painless wax' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  blurb?: string | null;

  @ApiPropertyOptional({ example: 'leaf', description: 'Ionicons name' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @ApiPropertyOptional({ enum: AIRA_SEGMENTS })
  @IsOptional()
  @IsIn(AIRA_SEGMENTS)
  segment?: (typeof AIRA_SEGMENTS)[number];

  @ApiPropertyOptional({ description: 'Image URL or data URL; empty uses the app photo' })
  @IsOptional()
  @IsString()
  @MaxLength(IMAGE_MAX_LENGTH)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAiraGroupDto extends PartialType(OmitType(CreateAiraGroupDto, ['id'] as const)) {}

export class CreateAiraItemDto {
  @ApiProperty({ example: 'wax-rica-full-arms' })
  @IsString()
  @Matches(SLUG, { message: SLUG_MESSAGE })
  @MaxLength(40)
  id: string;

  @ApiProperty({ example: 'waxing' })
  @IsString()
  @Matches(SLUG, { message: 'groupId is not a group id' })
  @MaxLength(40)
  groupId: string;

  @ApiPropertyOptional({ enum: AIRA_ITEM_KINDS })
  @IsOptional()
  @IsIn(AIRA_ITEM_KINDS)
  kind?: (typeof AIRA_ITEM_KINDS)[number];

  @ApiProperty({ example: 'Rica Full Arms Wax' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Waxing', description: 'Menu heading the service is listed under' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  section: string;

  @ApiProperty({ example: 30 })
  @IsInt()
  @Min(5)
  @Max(600)
  minutes: number;

  @ApiProperty({ example: 449 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  price: number;

  @ApiPropertyOptional({ example: 650, description: 'Struck-through price; leave empty for none' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  originalPrice?: number | null;

  @ApiPropertyOptional({ example: 4.8 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  rating?: number | null;

  @ApiPropertyOptional({ example: 1200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  reviewsCount?: number | null;

  @ApiPropertyOptional({ example: 'BESTSELLER' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  badge?: string | null;

  @ApiPropertyOptional({ enum: AIRA_SEGMENTS })
  @IsOptional()
  @IsIn(AIRA_SEGMENTS)
  segment?: (typeof AIRA_SEGMENTS)[number] | null;

  @ApiPropertyOptional({ example: ['Rica chocolate wax', 'Soothing gel'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  includes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(IMAGE_MAX_LENGTH)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAiraItemDto extends PartialType(OmitType(CreateAiraItemDto, ['id'] as const)) {}
