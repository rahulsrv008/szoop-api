import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerInquiry } from 'src/database/entities';
import { PartnerInquiriesController } from './partner-inquiries.controller';
import { PartnerInquiriesService } from './partner-inquiries.service';

@Module({
  imports: [TypeOrmModule.forFeature([PartnerInquiry])],
  controllers: [PartnerInquiriesController],
  providers: [PartnerInquiriesService],
  exports: [PartnerInquiriesService],
})
export class PartnerInquiriesModule {}
