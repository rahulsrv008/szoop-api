import { BadRequestException } from '@nestjs/common';

export type ClientAppCode = 'SZOOP' | 'AIRA';

export function clientAppCode(value?: string | string[]): ClientAppCode {
  const app = Array.isArray(value) ? value[0] : value;
  const normalized = app?.trim().toUpperCase() || 'SZOOP';
  if (normalized !== 'SZOOP' && normalized !== 'AIRA') {
    throw new BadRequestException('Unsupported client application');
  }
  return normalized;
}
