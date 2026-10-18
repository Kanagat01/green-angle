import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MeDto } from './dto/me.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        client: { select: { id: true, type: true, name: true } },
      },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      client: user.client,
    };
  }
}
