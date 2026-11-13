import {
  Body,
  Controller,
  Get,
  Headers,
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
import { AdminCustomersService } from './customers.service';
import { ListAdminCustomersDto } from './dto/list-customers.dto';
import { UpdateAdminCustomerDto } from './dto/update-customer.dto';
import { BlockAdminCustomerDto } from './dto/block-customer.dto';
import { clientAppCode } from 'src/common/types/client-app';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.CUSTOMERS)
export class AdminCustomersController {
  constructor(private readonly customersService: AdminCustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers with booking counts' })
  list(
    @Query() query: ListAdminCustomersDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.customersService.list(query, clientAppCode(app));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer profile, addresses, spend and bookings' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-client-app') app?: string,
  ) {
    return this.customersService.detail(id, clientAppCode(app));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update customer profile fields' })
  update(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminCustomerDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.customersService.update(adminId, id, dto, clientAppCode(app));
  }

  @Post(':id/block')
  @HttpCode(200)
  @ApiOperation({ summary: 'Block a customer account' })
  block(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockAdminCustomerDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.customersService.block(adminId, id, dto, clientAppCode(app));
  }

  @Post(':id/unblock')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore a blocked customer account' })
  unblock(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-client-app') app?: string,
  ) {
    return this.customersService.unblock(adminId, id, clientAppCode(app));
  }
}
