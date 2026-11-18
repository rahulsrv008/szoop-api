import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PARTNER_TYPES = [
  'Beauty professional',
  'Salon or beauty business',
  'Other partnership',
] as const;

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  return value.trim() || undefined;
};

export class CreatePartnerInquiryDto {
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @Transform(trimString)
  @IsString()
  @Matches(/^[+]?[0-9()\s.-]{7,30}$/)
  phone!: string;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @Transform(trimString)
  @IsIn(PARTNER_TYPES)
  partnerType!: (typeof PARTNER_TYPES)[number];

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
