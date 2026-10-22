import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export class PushKeysDto {
  @ApiProperty({ description: 'Публичный ключ подписки (p256dh), base64url' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  @Matches(BASE64URL)
  p256dh: string;

  @ApiProperty({
    description: 'Секрет аутентификации подписки (auth), base64url',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(BASE64URL)
  auth: string;
}

export class SubscribePushDto {
  @ApiProperty({
    description: 'Адрес подписки из PushSubscription.endpoint (https)',
    example: 'https://fcm.googleapis.com/fcm/send/…',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  endpoint: string;

  @ApiProperty({ type: PushKeysDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;
}

export class UnsubscribePushDto {
  @ApiProperty({ description: 'Адрес подписки, которую нужно удалить' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  endpoint: string;
}

export class PushConfigDto {
  @ApiProperty({
    description:
      'На сервере настроены ключи VAPID; иначе подписываться бессмысленно',
  })
  enabled: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Публичный ключ VAPID для pushManager.subscribe({ applicationServerKey })',
  })
  publicKey: string | null;
}
