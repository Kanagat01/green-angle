import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ClientType } from '../../generated/prisma/client.js';
import { normalizeEmail } from '../../users/dto/create-user.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Телефон храним в виде +79001234567: только цифры, российская 8 заменяется на 7. */
export const normalizePhone = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  let digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }
  return digits ? `+${digits}` : '';
};

const digitsOnly = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\D/g, '') : value;

export class RegisterDto {
  @ApiProperty({
    enum: ClientType,
    description:
      'COMPANY — компания по привозу (юр.лицо), PERSON — физ.лицо; определяет роль кабинета',
  })
  @IsEnum(ClientType)
  type: ClientType;

  @ApiProperty({
    example: 'ООО «АвтоПривоз Плюс»',
    description: 'Название компании или ФИО',
  })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example: '7707083893',
    description:
      'ИНН, 10 или 12 цифр; обязателен для COMPANY, для PERSON игнорируется',
  })
  @ValidateIf((o: RegisterDto) => o.type === ClientType.COMPANY)
  @Transform(digitsOnly)
  @Matches(/^(\d{10}|\d{12})$/, { message: 'inn must be 10 or 12 digits' })
  inn?: string;

  @ApiProperty({
    example: '+7 900 000-00-00',
    description: 'Телефон: хранится как +79000000000, не подтверждается',
  })
  @Transform(normalizePhone)
  @Matches(/^\+\d{11,15}$/, { message: 'phone must have 11 to 15 digits' })
  phone: string;

  @ApiProperty({ example: 'name@mail.ru' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({
    description: 'Согласие на обработку персональных данных; должно быть true',
  })
  @IsBoolean()
  @Equals(true, { message: 'consent must be given' })
  consent: boolean;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Токен из ссылки в письме' })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'name@mail.ru' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class AcceptedDto {
  @ApiProperty({
    example: 'accepted',
    description:
      'Ответ одинаков, существует ли такой адрес: наличие аккаунтов не раскрывается',
  })
  status: 'accepted';
}

export class VerifiedDto {
  @ApiProperty({ example: 'verified' })
  status: 'verified';
}
