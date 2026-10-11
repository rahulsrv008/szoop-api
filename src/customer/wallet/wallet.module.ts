import { Module } from '@nestjs/common';
import { CustomerWalletController } from './wallet.controller';

@Module({
  controllers: [CustomerWalletController],
})
export class CustomerWalletModule {}
