import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';

/** Socket.IO с CORS по тому же белому списку Origin, что и у HTTP API (CORS_ORIGINS). */
export class SocketIoAdapter extends IoAdapter {
  private allowedOrigins: string[] = [];

  withOrigins(origins: string[]): this {
    this.allowedOrigins = origins;
    return this;
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // Пустой список — CORS-заголовки не отправляются: кросс-доменные браузеры не подключатся
    const cors =
      this.allowedOrigins.length > 0
        ? { origin: this.allowedOrigins, methods: ['GET', 'POST'] }
        : undefined;
    return super.createIOServer(port, { ...options, cors } as ServerOptions);
  }
}
