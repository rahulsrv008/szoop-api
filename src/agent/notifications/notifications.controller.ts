import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AgentAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AgentNotificationsService } from './notifications.service';
import { ListAgentNotificationsDto } from './dto/list-notifications.dto';
import {
  RegisterDeviceTokenDto,
  RemoveDeviceTokenDto,
} from './dto/device-token.dto';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';

@ApiTags('agent')
@AgentAuth()
@Controller(ROUTES.AGENT.NOTIFICATIONS)
export class AgentNotificationsController {
  constructor(
    private readonly notificationsService: AgentNotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List notifications with the unread count' })
  list(
    @CurrentUser('sub') userId: string,
    @Query() query: ListAgentNotificationsDto,
  ) {
    return this.notificationsService.list(userId, query);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(
    @CurrentUser('sub') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.markRead(userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark every notification as read' })
  markAllRead(@CurrentUser('sub') userId: string) {
    return this.notificationsService.markAllRead(userId);
  }

  @RateLimit(RATE_LIMITS.DEVICE_TOKEN)
  @Post('device-token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register this device for push notifications' })
  registerDevice(
    @CurrentUser('sub') userId: string,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notificationsService.registerDevice(userId, dto);
  }

  @Delete('device-token')
  @ApiOperation({ summary: 'Stop push notifications for this device' })
  removeDevice(
    @CurrentUser('sub') userId: string,
    @Body() dto: RemoveDeviceTokenDto,
  ) {
    return this.notificationsService.removeDevice(userId, dto);
  }
}
