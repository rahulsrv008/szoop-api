import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminMissedJobsService } from './missed-jobs.service';
import { AdminMissedJobAgentsDto, ListAdminMissedJobsDto, WarnAgentDto } from './dto/missed-jobs.dto';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.MISSED_JOBS)
export class AdminMissedJobsController {
  constructor(private readonly missedJobsService: AdminMissedJobsService) {}

  @Get('agents')
  @ApiOperation({ summary: 'Agents who held a job and did not do it, with counts per reason (last 30 days by default)' })
  agents(@Query() query: AdminMissedJobAgentsDto) {
    return this.missedJobsService.agents(query);
  }

  @Get()
  @ApiOperation({ summary: 'The missed bookings, newest first' })
  list(@Query() query: ListAdminMissedJobsDto) {
    return this.missedJobsService.list(query);
  }

  @Get('agents/:agentId/warning')
  @ApiOperation({ summary: 'The standard warning text for this agent (to read or edit before sending)' })
  warningPreview(@Param('agentId', ParseUUIDPipe) agentId: string) {
    return this.missedJobsService.warningPreview(agentId);
  }

  @Post('agents/:agentId/warn')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the agent a warning (push + in-app) covering their unwarned misses' })
  warn(
    @CurrentUser('sub') adminId: string,
    @Param('agentId', ParseUUIDPipe) agentId: string,
    @Body() dto: WarnAgentDto,
  ) {
    return this.missedJobsService.warn(adminId, agentId, dto);
  }
}
