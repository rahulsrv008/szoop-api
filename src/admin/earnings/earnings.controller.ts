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
import { AdminEarningsService } from './earnings.service';
import { ListAdminEarningsDto } from './dto/list-earnings.dto';
import { AdminEarningsSummaryDto } from './dto/earnings-summary.dto';
import { ListAdminIncentivesDto } from './dto/list-incentives.dto';
import { GenerateAdminIncentivesDto } from './dto/generate-incentives.dto';
import { UpdateAdminIncentiveDto } from './dto/update-incentive.dto';
import { ListAdminSalaryDto } from './dto/list-salary.dto';
import { GenerateAdminSalaryDto } from './dto/generate-salary.dto';
import { UpdateAdminSalaryDto } from './dto/update-salary.dto';
import { clientAppCode } from 'src/common/types/client-app';

/** Agent payouts: per-booking earnings, monthly incentives and salary runs. */
@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.EARNINGS)
export class AdminEarningsController {
  constructor(private readonly earningsService: AdminEarningsService) {}

  @Get()
  @ApiOperation({ summary: 'List agent earning rows with totals' })
  listEarnings(
    @Query() query: ListAdminEarningsDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.earningsService.listEarnings(query, clientAppCode(app));
  }

  @Get('summary')
  @ApiOperation({ summary: 'Per-agent earnings summary for a month' })
  summary(
    @Query() query: AdminEarningsSummaryDto,
    @Headers('x-client-app') app?: string,
  ) {
    return this.earningsService.summary(query, clientAppCode(app));
  }

  @Get('incentives')
  @ApiOperation({ summary: 'List monthly agent incentives' })
  listIncentives(@Query() query: ListAdminIncentivesDto) {
    return this.earningsService.listIncentives(query);
  }

  @Post('incentives/generate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generate or refresh incentives for a month' })
  generateIncentives(
    @CurrentUser('sub') adminId: string,
    @Body() dto: GenerateAdminIncentivesDto,
  ) {
    return this.earningsService.generateIncentives(adminId, dto);
  }

  @Patch('incentives/:id')
  @ApiOperation({ summary: 'Approve, pay or reject an incentive' })
  updateIncentive(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminIncentiveDto,
  ) {
    return this.earningsService.updateIncentive(adminId, id, dto);
  }

  @Get('salary')
  @ApiOperation({ summary: 'List monthly salary records' })
  listSalary(@Query() query: ListAdminSalaryDto) {
    return this.earningsService.listSalary(query);
  }

  @Post('salary/generate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Generate or refresh salary records for a month' })
  generateSalary(
    @CurrentUser('sub') adminId: string,
    @Body() dto: GenerateAdminSalaryDto,
  ) {
    return this.earningsService.generateSalary(adminId, dto);
  }

  @Patch('salary/:id')
  @ApiOperation({ summary: 'Update a salary record and recompute net salary' })
  updateSalary(
    @CurrentUser('sub') adminId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminSalaryDto,
  ) {
    return this.earningsService.updateSalary(adminId, id, dto);
  }
}
