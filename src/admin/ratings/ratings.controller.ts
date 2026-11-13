import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminRatingsService } from './ratings.service';
import { ListAdminRatingsDto } from './dto/list-ratings.dto';
import { clientAppCode } from 'src/common/types/client-app';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.RATINGS)
export class AdminRatingsController {
  constructor(private readonly ratingsService: AdminRatingsService) {}

  @Get()
  @ApiOperation({ summary: 'List ratings with a star breakdown summary' })
  list(
    @Query() query: ListAdminRatingsDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.ratingsService.list(query, clientAppCode(app));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Rating detail with its reviews' })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-client-app') app?: string,
  ) {
    return this.ratingsService.detail(id, clientAppCode(app));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Moderation: delete a rating and its reviews' })
  remove(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-client-app') app?: string,
  ) {
    return this.ratingsService.remove(adminId, id, clientAppCode(app));
  }
}
