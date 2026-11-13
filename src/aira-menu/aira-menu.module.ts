import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiraBeautyGroup, AiraBeautyItem } from 'src/database/entities';
import { AdminAiraMenuController, CustomerAiraMenuController } from './aira-menu.controller';
import { AiraMenuService } from './aira-menu.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiraBeautyGroup, AiraBeautyItem])],
  controllers: [CustomerAiraMenuController, AdminAiraMenuController],
  providers: [AiraMenuService],
  exports: [AiraMenuService],
})
export class AiraMenuModule {}
