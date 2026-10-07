import { Module } from '@nestjs/common';
import { ProfileVisitorsService } from './profile-visitors.service';
import { ProfileVisitorsController } from './profile-visitors.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileVisitor } from './entities/profile-visitor.entity';
import { UserEventModule } from 'src/user-event/user-event.module';
import { User } from 'src/users/entities/user.entity';
import { RelationStatusModule } from 'src/relation-status/relation-status.module';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProfileVisitor, User]),
    UserEventModule,
    RelationStatusModule,
    RedisModule,
  ],
  controllers: [ProfileVisitorsController],
  providers: [ProfileVisitorsService],
  exports: [ProfileVisitorsService],
})
export class ProfileVisitorsModule {}
