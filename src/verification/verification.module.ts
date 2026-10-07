import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/users/entities/user.entity';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [TypeOrmModule.forFeature([User]), HttpModule],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
