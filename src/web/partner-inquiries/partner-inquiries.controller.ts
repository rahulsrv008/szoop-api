import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ROUTES } from 'src/app.routes';
import { RateLimit } from 'src/common/rate-limit/rate-limit.decorator';
import { RATE_LIMITS } from 'src/common/rate-limit/rate-limit.rules';
import { PartnerInquiriesService } from './partner-inquiries.service';
import { CreatePartnerInquiryDto } from './dto/create-partner-inquiry.dto';

@ApiTags('web')
@Controller(ROUTES.WEB.PARTNER_INQUIRIES)
export class PartnerInquiriesController {
  constructor(private readonly inquiries: PartnerInquiriesService) {}

  @Post()
  @RateLimit(RATE_LIMITS.PARTNER_INQUIRY)
  @ApiOperation({ summary: 'Save a partner inquiry from the Aira website' })
  async create(@Body() dto: CreatePartnerInquiryDto) {
    await this.inquiries.create(dto);
    return { message: 'Your inquiry was received. Our team will be in touch.' };
  }
}
