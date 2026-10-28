import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import {
  AcceptedDto,
  RegisterDto,
  ResendVerificationDto,
  VerifiedDto,
  VerifyEmailDto,
} from './dto/register.dto.js';
import { TokenPairDto } from './dto/token-pair.dto.js';
import { RegistrationService } from './registration.service.js';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenPairDto })
  @ApiUnauthorizedResponse({ description: 'Неверный email или пароль' })
  @ApiForbiddenResponse({
    description:
      'Пароль верный, но почта не подтверждена (code: EMAIL_NOT_VERIFIED)',
  })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  /**
   * Самостоятельная регистрация компании по привозу (COMPANY) или физлица (PERSON). Аккаунт
   * создаётся закрытым, на почту уходит ссылка подтверждения. Ответ не зависит от того, занят ли
   * адрес.
   */
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async register(@Body() dto: RegisterDto): Promise<AcceptedDto> {
    await this.registration.register(dto);
    return {
      status: this.registration.requiresVerification
        ? 'accepted'
        : 'registered',
    };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VerifiedDto })
  @ApiBadRequestResponse({
    description: 'Ссылка недействительна или просрочена (code: INVALID_TOKEN)',
  })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<VerifiedDto> {
    await this.registration.verify(dto.token);
    return { status: 'verified' };
  }

  /** Повторное письмо подтверждения. Ответ не раскрывает, есть ли такой аккаунт. */
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: AcceptedDto })
  async resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<AcceptedDto> {
    await this.registration.resend(dto.email);
    return { status: 'accepted' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenPairDto })
  @ApiUnauthorizedResponse({
    description: 'Refresh-токен недействителен, отозван или просрочен',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }
}
