import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AdminCouponRulesService } from './coupon-rules.service';
import { CreateCouponRuleDto } from './dto/create-coupon-rule.dto';
import { UpdateCouponRuleDto } from './dto/update-coupon-rule.dto';
import { ListCouponRulesDto } from './dto/list-coupon-rules.dto';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.COUPON_RULES)
export class AdminCouponRulesController {
  constructor(private readonly rulesService: AdminCouponRulesService) {}

  @Get()
  @ApiOperation({ summary: 'List coupon eligibility rules with pagination and filters' })
  list(@Query() query: ListCouponRulesDto) {
    return this.rulesService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a single coupon eligibility rule' })
  get(@Param('id') id: string) {
    return this.rulesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new coupon eligibility rule' })
  create(
    @CurrentUser('sub') adminId: string,
    @Body() dto: CreateCouponRuleDto,
  ) {
    return this.rulesService.create(adminId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing coupon eligibility rule' })
  update(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCouponRuleDto,
  ) {
    return this.rulesService.update(adminId, id, dto);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Toggle active status of a coupon eligibility rule' })
  toggle(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
  ) {
    return this.rulesService.toggle(adminId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete or deactivate a coupon eligibility rule' })
  remove(
    @CurrentUser('sub') adminId: string,
    @Param('id') id: string,
  ) {
    return this.rulesService.remove(adminId, id);
  }
}
