import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import {
  PushConfigDto,
  SubscribePushDto,
  UnsubscribePushDto,
} from './dto/push.dto.js';
import { PushService } from './push.service.js';

/** Подписки браузера на push о сообщениях в диалоге. Доступны любой авторизованной роли. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('push/public-key')
  @ApiOkResponse({ type: PushConfigDto })
  config(): PushConfigDto {
    return this.push.config();
  }

  /** Сохраняет подписку этого устройства (повторный вызов обновляет её). */
  @Post('push-subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.push.subscribe(user.id, dto, userAgent);
  }

  @Delete('push-subscriptions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UnsubscribePushDto,
  ) {
    await this.push.unsubscribe(user.id, dto.endpoint);
  }
}
