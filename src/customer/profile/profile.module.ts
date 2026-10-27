import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer, SupportTicket, User } from 'src/database/entities';
import { CustomerAccountDeletionController } from './account-deletion.controller';
import { CustomerProfileController } from './profile.controller';
import { CustomerProfileService } from './profile.service';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, SupportTicket, User])],
  controllers: [CustomerProfileController, CustomerAccountDeletionController],
  providers: [CustomerProfileService],
})
export class CustomerProfileModule {}
