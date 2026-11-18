import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { AdminAuth } from 'src/common/decorators/authorize.decorator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';
import { PartnerInquiriesService } from 'src/web/partner-inquiries/partner-inquiries.service';

@ApiTags('admin')
@AdminAuth()
@Controller(ROUTES.ADMIN.PARTNER_INQUIRIES)
export class AdminPartnerInquiriesController {
  constructor(private readonly inquiries: PartnerInquiriesService) {}

  @Get()
  @ApiOperation({ summary: 'List Aira website partner inquiries' })
  list(@Query() query: PaginationQueryDto) {
    return this.inquiries.list(query);
  }
}
