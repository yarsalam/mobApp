import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FilterUsersDto } from './dto/FilterUsersDto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create({ ...createUserDto });
  }

  @UseGuards(JwtAuthGuard)
  @Get('all')
  async findAllUsersExceptMe(@Req() req) {
    const users = await this.usersService.findAllUsersExceptMe(req.user.sub);
    return users;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(+id, updateUserDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('filter')
  async filterUsers(
    @Body() filterDto: FilterUsersDto,
    @Req() req,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    console.log('filterDto:', JSON.stringify(filterDto, null, 2));
    console.log('BODY RAW =>', req.body);
    console.log('DTO =>', filterDto);
    return this.usersService.filterUsers(
      filterDto,
      req.user.sub,
      page ? +page : 0,
      limit ? +limit : 10,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('filter/count')
  async filterUsersCount(@Body() filterDto: FilterUsersDto, @Req() req) {
    const count = await this.usersService.countFilteredUsers(
      filterDto,
      req.user.sub,
    );
    return { count };
  }

  @Get('explore')
  @UseGuards(JwtAuthGuard) // ← اضافه شد — باید لاگین باشه
  async exploreUsers(
    @Req() req,
    @Query('page', ParseIntPipe) page: number,
    @Query('limit', ParseIntPipe) limit: number,
  ) {
    return this.usersService.exploreUsers(req.user.sub, page, limit);
  }

  @Get('recent-similar')
  @UseGuards(JwtAuthGuard) // ← اضافه شد
  async getRecentSimilarUsers(
    @Req() req, // ← اضافه شد
    @Query('limit') limit?: number,
    @Query('daysAgo') daysAgo?: number,
  ) {
    // userId از JWT می‌خونیم، نه از query param
    const userId = req.user.sub;
    return this.usersService.findRecentSimilarUsers(
      userId,
      limit ? +limit : 5,
      daysAgo ? +daysAgo : 30,
    );
  }

  @Get('profile/:id')
  @UseGuards(JwtAuthGuard)
  async getUserProfile(@Param('id') id: number) {
    return this.usersService.findFullProfile(id);
  }

  @Patch(':id/suspend')
  @UseGuards(JwtAuthGuard)
  async suspendAccount(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.suspendAccount(id);
  }

  @Patch(':id/resign')
  @UseGuards(JwtAuthGuard)
  async resignAccount(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.resignAccount(id);
  }
}
