import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const HOME_LAYOUTS = ['HALF', 'FULL'] as const;
export const HOME_ACTIONS = ['POPUP', 'OPTIONS', 'COMING_SOON'] as const;

/** Small icons are stored inline as data URLs, so allow a generous length. */
const ICON_MAX_LENGTH = 400_000;
const IMAGE_MAX_LENGTH = 2_000_000;

export class HomeHighlightDto {
  @ApiProperty({ example: 'Sweeping & mopping of all rooms' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  text: string;

  @ApiPropertyOptional({
    description: 'Image URL, data URL, or an Ionicons name (e.g. "sparkles")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(ICON_MAX_LENGTH)
  icon?: string | null;
}

export class HomePricingTierDto {
  @ApiProperty({ example: '90 min' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  @ApiPropertyOptional({ example: '7 AM – 11 AM' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  subtitle?: string | null;

  @ApiPropertyOptional({ example: 90, description: 'Visit length in minutes' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  minutes?: number | null;

  @ApiPropertyOptional({ example: '08:00', description: 'Shift start, HH:MM' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must be HH:MM' })
  startTime?: string | null;

  @ApiProperty({ example: 429 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  price: number;
}

class HighlightsField {
  @ApiPropertyOptional({ type: [HomeHighlightDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => HomeHighlightDto)
  highlights?: HomeHighlightDto[];

  @ApiPropertyOptional({
    type: [HomePricingTierDto],
    description: 'Durations (On Demand) or shifts (monthly plans) the customer picks from',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => HomePricingTierDto)
  pricing?: HomePricingTierDto[];
}

export class CreateHomeCategoryDto extends HighlightsField {
  @ApiProperty({ example: 'Hourly Help' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({ example: 'Book an expert by the hour' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string | null;

  @ApiPropertyOptional({ example: 'NEW' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  badge?: string | null;

  @ApiPropertyOptional({ description: 'Image URL or data URL' })
  @IsOptional()
  @IsString()
  @MaxLength(IMAGE_MAX_LENGTH)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: '#EDE4F5' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tileColor?: string | null;

  @ApiPropertyOptional({ enum: HOME_LAYOUTS, default: 'HALF' })
  @IsOptional()
  @IsIn(HOME_LAYOUTS)
  layout?: (typeof HOME_LAYOUTS)[number];

  @ApiPropertyOptional({ enum: HOME_ACTIONS, default: 'POPUP' })
  @IsOptional()
  @IsIn(HOME_ACTIONS)
  actionType?: (typeof HOME_ACTIONS)[number];

  @ApiPropertyOptional({ example: 'What our expert will do' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  popupTitle?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHomeCategoryDto extends PartialType(CreateHomeCategoryDto) {}

export class CreateHomeCategoryOptionDto extends HighlightsField {
  @ApiProperty({ example: 'Healthy Cook' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({ example: 'Daily home-style meals' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string | null;

  @ApiPropertyOptional({ example: '₹4,999 / month' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  priceLabel?: string | null;

  @ApiPropertyOptional({ example: 'BEST VALUE' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  badge?: string | null;

  @ApiPropertyOptional({ description: 'Image URL or data URL' })
  @IsOptional()
  @IsString()
  @MaxLength(IMAGE_MAX_LENGTH)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: 'What your cook will do' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  popupTitle?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHomeCategoryOptionDto extends PartialType(
  CreateHomeCategoryOptionDto,
) {}

export class CreateHomePopularItemDto {
  @ApiProperty({ example: 'Deep kitchen clean' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ example: '2 hrs · 1 expert' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string | null;

  @ApiPropertyOptional({ description: 'Image URL or data URL' })
  @IsOptional()
  @IsString()
  @MaxLength(IMAGE_MAX_LENGTH)
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: '₹499' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  priceLabel?: string | null;

  @ApiPropertyOptional({ example: 'TRENDING' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  badge?: string | null;

  @ApiPropertyOptional({ example: 4.8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(5)
  rating?: number | null;

  @ApiPropertyOptional({ description: 'Home category opened on tap' })
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @ApiPropertyOptional({ description: 'Specific option opened on tap' })
  @IsOptional()
  @IsUUID()
  optionId?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHomePopularItemDto extends PartialType(
  CreateHomePopularItemDto,
) {}
