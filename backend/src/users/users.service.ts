import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MeDto } from './dto/me.dto.js';
import { UpdateMeDto } from './dto/update-me.dto.js';

const profileSelect = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  emailNotifications: true,
  client: { select: { id: true, type: true, name: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
    if (!user || !user.isActive) throw new UnauthorizedException();

    return toProfile(user);
  }

  /** Личные настройки: сейчас — письма о смене статуса машины. */
  async updateProfile(userId: string, dto: UpdateMeDto): Promise<MeDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.emailNotifications === undefined
          ? {}
          : { emailNotifications: dto.emailNotifications }),
      },
      select: profileSelect,
    });
    return toProfile(user);
  }
}

function toProfile(user: {
  id: string;
  email: string;
  role: MeDto['role'];
  emailNotifications: boolean;
  client: MeDto['client'];
}): MeDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    emailNotifications: user.emailNotifications,
    client: user.client,
  };
}
