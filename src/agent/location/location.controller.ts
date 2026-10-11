import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AgentAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AgentLocationService } from './location.service';
import { CreateAgentLocationDto } from './dto/create-location.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('agent')
@AgentAuth()
@Controller(ROUTES.AGENT.LOCATION)
export class AgentLocationController {
  constructor(private readonly locationService: AgentLocationService) {}

  @RateLimit(RATE_LIMITS.AGENT_LOCATION)
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Record a location ping' })
  record(
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateAgentLocationDto,
  ) {
    return this.locationService.record(userId, dto);
  }

  @Get('latest')
  @ApiOperation({ summary: 'Most recent location ping for this agent' })
  latest(@CurrentUser('sub') userId: string) {
    return this.locationService.latest(userId);
  }
}
