import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { AiraMenuService } from './aira-menu.service';
import {
  CreateAiraGroupDto,
  CreateAiraItemDto,
  UpdateAiraGroupDto,
  UpdateAiraItemDto,
} from './dto/aira-menu.dto';

/** Public, like the Szoop home screen: shown before sign-in and holds no personal data. */
@ApiTags('customer')
@Controller(ROUTES.CUSTOMER.AIRA_MENU)
export class CustomerAiraMenuController {
  constructor(private readonly menu: AiraMenuService) {}

  @Get()
  @ApiOperation({ summary: 'Aira Luxury menu: groups, services, prices and brand copy' })
  get() {
    return this.menu.menu();
  }
}

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.AIRA_MENU)
export class AdminAiraMenuController {
  constructor(private readonly menu: AiraMenuService) {}

  @Get()
  @ApiOperation({ summary: 'All Aira groups and services, including hidden ones' })
  list() {
    return this.menu.adminList();
  }

  @Post('groups')
  @ApiOperation({ summary: 'Create an Aira home group' })
  createGroup(@Body() dto: CreateAiraGroupDto) {
    return this.menu.createGroup(dto);
  }

  @Patch('groups/:id')
  @ApiOperation({ summary: 'Update an Aira home group' })
  updateGroup(@Param('id') id: string, @Body() dto: UpdateAiraGroupDto) {
    return this.menu.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  @ApiOperation({ summary: 'Delete an empty Aira home group' })
  deleteGroup(@Param('id') id: string) {
    return this.menu.deleteGroup(id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Create an Aira service or package' })
  createItem(@Body() dto: CreateAiraItemDto) {
    return this.menu.createItem(dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Update an Aira service or package' })
  updateItem(@Param('id') id: string, @Body() dto: UpdateAiraItemDto) {
    return this.menu.updateItem(id, dto);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Delete an Aira service or package' })
  deleteItem(@Param('id') id: string) {
    return this.menu.deleteItem(id);
  }
}
