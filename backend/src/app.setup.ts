import { INestApplication, ValidationPipe } from '@nestjs/common';

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1', { exclude: [] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
