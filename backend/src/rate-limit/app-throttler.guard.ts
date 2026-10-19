import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/** Ограничение частоты запросов. WebSocket-команды не лимитируем: сокет уже аутентифицирован. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  override canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);
    return super.canActivate(context);
  }

  /**
   * Библиотека ставит заголовок вида `Retry-After-<имя лимитера>`; клиентам нужен стандартный
   * `Retry-After` (секунды до снятия блокировки).
   */
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    this.setResponseHeader(
      res,
      'Retry-After',
      Math.max(1, detail.timeToBlockExpire || detail.timeToExpire),
    );
    return super.throwThrottlingException(context, detail);
  }
}
