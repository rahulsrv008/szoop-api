import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminHomeContentService } from './home-content.service';
import {
  CreateHomeCategoryDto,
  CreateHomeCategoryOptionDto,
  CreateHomePopularItemDto,
  UpdateHomeCategoryDto,
  UpdateHomeCategoryOptionDto,
  UpdateHomePopularItemDto,
  UpdateHomeScreenDto,
} from './dto/home-content.dto';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.HOME_CONTENT)
export class AdminHomeContentController {
  constructor(private readonly homeContent: AdminHomeContentService) {}

  @Get('categories')
  @ApiOperation({ summary: 'Customer home categories with their options' })
  listCategories() {
    return this.homeContent.listCategories();
  }

  @Get('screen')
  @ApiOperation({ summary: 'Customer front-page copy: offers, trust, how it works' })
  getScreen() {
    return this.homeContent.getScreen();
  }

  @Put('screen')
  @ApiOperation({ summary: 'Save the customer front-page sections' })
  updateScreen(
    @CurrentUser('sub') adminId: string,
    @Body() dto: UpdateHomeScreenDto,
  ) {
    return this.homeContent.updateScreen(adminId, dto);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a customer home category' })
  createCategory(
    @CurrentUser('sub') adminId: string,
    @Body() dto: CreateHomeCategoryDto,
  ) {
    return this.homeContent.createCategory(adminId, dto);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a customer home category' })
  updateCategory(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHomeCategoryDto,
  ) {
    return this.homeContent.updateCategory(adminId, id, dto);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Delete a home category and its options' })
  removeCategory(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.homeContent.removeCategory(adminId, id);
  }

  @Post('categories/:id/options')
  @ApiOperation({ summary: 'Add an option (e.g. Healthy Cook) to a category' })
  createOption(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) categoryId: string,
    @Body() dto: CreateHomeCategoryOptionDto,
  ) {
    return this.homeContent.createOption(adminId, categoryId, dto);
  }

  @Patch('options/:id')
  @ApiOperation({ summary: 'Update a category option' })
  updateOption(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHomeCategoryOptionDto,
  ) {
    return this.homeContent.updateOption(adminId, id, dto);
  }

  @Delete('options/:id')
  @ApiOperation({ summary: 'Delete a category option' })
  removeOption(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.homeContent.removeOption(adminId, id);
  }

  @Get('popular')
  @ApiOperation({ summary: 'Most popular cards on the customer home' })
  listPopular() {
    return this.homeContent.listPopular();
  }

  @Post('popular')
  @ApiOperation({ summary: 'Add a most popular card' })
  createPopular(
    @CurrentUser('sub') adminId: string,
    @Body() dto: CreateHomePopularItemDto,
  ) {
    return this.homeContent.createPopular(adminId, dto);
  }

  @Patch('popular/:id')
  @ApiOperation({ summary: 'Update a most popular card' })
  updatePopular(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHomePopularItemDto,
  ) {
    return this.homeContent.updatePopular(adminId, id, dto);
  }

  @Delete('popular/:id')
  @ApiOperation({ summary: 'Remove a most popular card' })
  removePopular(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.homeContent.removePopular(adminId, id);
  }
}
