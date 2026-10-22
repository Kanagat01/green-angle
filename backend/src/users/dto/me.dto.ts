import { ApiProperty } from '@nestjs/swagger';
import { ClientType, Role } from '../../generated/prisma/client.js';

export class MeClientDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ClientType })
  type: ClientType;

  @ApiProperty({ example: 'ООО АвтоПодбор Плюс' })
  name: string;
}

export class MeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({
    description:
      'Письма о смене статуса машины на email пользователя (для физлица)',
  })
  emailNotifications: boolean;

  @ApiProperty({
    type: MeClientDto,
    nullable: true,
    description: 'null у ADMIN',
  })
  client: MeClientDto | null;
}
