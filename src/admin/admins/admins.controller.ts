import {
  Body,
  Controller,
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
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminAdminsService } from './admins.service';
import {
  CreateAdminDto,
  ListAdminsDto,
  UpdateAdminDto,
} from './dto/admins.dto';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.ADMINS)
export class AdminAdminsController {
  constructor(private readonly adminsService: AdminAdminsService) {}

  @Get()
  @ApiOperation({ summary: 'List Admin Web users' })
  list(@Query() query: ListAdminsDto) {
    return this.adminsService.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create an Admin Web user' })
  create(@CurrentUser('sub') adminId: string, @Body() dto: CreateAdminDto) {
    return this.adminsService.create(adminId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an Admin Web user (optional password reset)' })
  update(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDto,
  ) {
    return this.adminsService.update(adminId, id, dto);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reactivate a disabled admin' })
  activate(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminsService.activate(adminId, id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable an admin and revoke their sessions' })
  deactivate(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminsService.deactivate(adminId, id);
    //added comment to test the commit
  }
}
