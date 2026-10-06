import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminNotificationsService } from './notifications.service';
import { SendAdminNotificationDto } from './dto/send-notification.dto';
import { ListAdminNotificationsDto } from './dto/list-notifications.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.NOTIFICATIONS)
export class AdminNotificationsController {
  constructor(
    private readonly notificationsService: AdminNotificationsService,
  ) {}

  @RateLimit(RATE_LIMITS.ADMIN_BROADCAST)
  @Post('send')
  @HttpCode(200)
  @ApiOperation({ summary: 'Broadcast a notification to an audience' })
  send(
    @CurrentUser('sub') adminId: string,
    @Body() dto: SendAdminNotificationDto,
  ) {
    return this.notificationsService.send(adminId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Recently sent notifications with read state' })
  list(@Query() query: ListAdminNotificationsDto) {
    return this.notificationsService.list(query);
  }
}
