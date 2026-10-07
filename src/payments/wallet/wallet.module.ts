import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserWallet } from './entities/user-wallet.entity';
import { WalletService } from './wallet.service';
import { UserEventModule } from 'src/user-event/user-event.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserWallet]), UserEventModule],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
