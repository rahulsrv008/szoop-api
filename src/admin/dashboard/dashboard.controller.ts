import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { AdminDashboardService } from './dashboard.service';
import { AdminDashboardQueryDto } from './dto/dashboard-query.dto';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.DASHBOARD)
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Aggregated Admin Web home-screen metrics' })
  overview(@Query() query: AdminDashboardQueryDto) {
    return this.dashboardService.overview(query);
  }

  @Get('live-map')
  @ApiOperation({
    summary: 'Active customers and recent agent locations in the admin zones',
  })
  liveMap() {
    return this.dashboardService.liveMap();
  }
}
