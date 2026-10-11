import { SecuritySchemeObject } from '@nestjs/swagger';

export const SwaggerConfig: SecuritySchemeObject = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  name: 'Authorization',
  description: 'Enter JWT token',
  in: 'header',
};
