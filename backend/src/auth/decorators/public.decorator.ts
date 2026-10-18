import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Отключает проверку JWT для маршрута. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
