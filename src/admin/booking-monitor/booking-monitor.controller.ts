import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminBookingMonitorService } from './booking-monitor.service';
import { MonitorNudgeDto } from './dto/monitor-nudge.dto';
import { UpdateMonitorRulesDto } from './dto/update-monitor-rules.dto';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.BOOKING_MONITOR)
export class AdminBookingMonitorController {
  constructor(private readonly monitor: AdminBookingMonitorService) {}

  @Get()
  @ApiOperation({
    summary:
      'Live jobs timed against their next step (orange/red times included), plus which agents are online',
  })
  board() {
    return this.monitor.board();
  }

  @Put('rules')
  @ApiOperation({ summary: 'Change when monitored jobs turn orange and red (super admin)' })
  updateRules(@CurrentUser('sub') adminId: string, @Body() dto: UpdateMonitorRulesDto) {
    return this.monitor.updateRules(adminId, dto);
  }

  @Post('nudge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Push a nudge to an agent in your zones (or holding a job in them)' })
  nudge(@CurrentUser('sub') adminId: string, @Body() dto: MonitorNudgeDto) {
    return this.monitor.nudge(adminId, dto);
  }
}
