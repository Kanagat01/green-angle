import { ApiProperty } from '@nestjs/swagger';
import { ClientType, Role } from '../../generated/prisma/client.js';

export class AdminUserClientDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ClientType })
  type: ClientType;

  @ApiProperty()
  name: string;
}

/** Пользователь для супер ЛК. Хеш пароля наружу не отдаётся. */
export class AdminUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ nullable: true, type: String })
  clientId: string | null;

  @ApiProperty({ type: AdminUserClientDto, nullable: true })
  client: AdminUserClientDto | null;

  @ApiProperty()
  createdAt: Date;
}

export class AdminUserListDto {
  @ApiProperty({ type: [AdminUserDto] })
  items: AdminUserDto[];

  @ApiProperty({ description: 'Всего записей по фильтру' })
  total: number;
}

export class ResetPasswordResultDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Сгенерированный временный пароль (показывается один раз) или null, если пароль задан вручную',
  })
  temporaryPassword: string | null;
}
