import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { firstValueFrom } from 'rxjs';
import { HealthService, HealthPayload } from './health.service';
import { ROUTES } from '../app.routes';
import { NoRateLimit } from 'src/common/rate-limit/rate-limit.decorator';

@ApiTags('health')
@NoRateLimit()
@Controller(ROUTES.HEALTH)
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness — database connectivity' })
  async health() {
    const body = (await firstValueFrom(
      this.healthService.getHealthStatus(),
    )) as HealthPayload;
    if (body.status !== 'ok') {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
