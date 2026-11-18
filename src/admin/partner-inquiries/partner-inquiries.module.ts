import { Module } from '@nestjs/common';
import { PartnerInquiriesModule } from 'src/web/partner-inquiries/partner-inquiries.module';
import { AdminPartnerInquiriesController } from './partner-inquiries.controller';

@Module({
  imports: [PartnerInquiriesModule],
  controllers: [AdminPartnerInquiriesController],
})
export class AdminPartnerInquiriesModule {}
