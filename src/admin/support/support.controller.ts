import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminSupportService } from './support.service';
import { ListAdminSupportDto } from './dto/list-support.dto';
import { UpdateAdminSupportTicketDto } from './dto/update-support.dto';
import { clientAppCode } from 'src/common/types/client-app';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.SUPPORT)
export class AdminSupportController {
  constructor(private readonly supportService: AdminSupportService) {}

  @Get()
  @ApiOperation({ summary: 'List support tickets with the raiser and booking' })
  list(
    @Query() query: ListAdminSupportDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.supportService.list(query, clientAppCode(app));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ticket detail with raiser and linked booking' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-client-app') app?: string,
  ) {
    return this.supportService.detail(id, clientAppCode(app));
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update status/priority; a resolutionNote is sent to the raiser as a notification',
  })
  update(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminSupportTicketDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.supportService.update(adminId, id, dto, clientAppCode(app));
  }
}
