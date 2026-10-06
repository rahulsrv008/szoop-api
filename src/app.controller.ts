import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { AppService } from './app.service';
import { NoRateLimit } from './common/rate-limit/rate-limit.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiExcludeEndpoint()
  root() {
    return this.appService.getHello();
  }

  @Get('health')
  @NoRateLimit()
  @ApiExcludeEndpoint()
  liveness() {
    return this.appService.getLiveness();
  }
}
