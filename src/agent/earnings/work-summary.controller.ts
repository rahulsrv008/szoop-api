import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AgentAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AgentWorkSummaryService } from './work-summary.service';

@ApiTags('agent')
@AgentAuth()
@Controller(ROUTES.AGENT.WORK_SUMMARY)
export class AgentWorkSummaryController {
  constructor(private readonly workSummaryService: AgentWorkSummaryService) {}

  @Get()
  @ApiOperation({
    summary: 'Jobs, hours, days online, on-time starts, last 7 days and monthly salary',
  })
  summary(@CurrentUser('sub') userId: string) {
    return this.workSummaryService.summary(userId);
  }
}
