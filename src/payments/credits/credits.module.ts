import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserCredits } from './entities/user-credits.entity';
import { UserEventModule } from 'src/user-event/user-event.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserCredits]), UserEventModule],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
