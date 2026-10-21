import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createApp } from './helpers.js';

type Schema = {
  properties?: Record<string, { nullable?: boolean; type?: string }>;
  required?: string[];
};
type Doc = {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Schema> };
};

/**
 * Контракт для фронтенда: по OpenAPI генерируются типы, поэтому всё, что изменилось в API под
 * макет, должно быть описано в схеме, а служебные маршруты — не попадать в неё.
 */
describe('OpenAPI document (e2e)', () => {
  let app: NestFastifyApplication;
  let doc: Doc;

  beforeAll(async () => {
    app = await createApp();
    doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('t')
        .setVersion('1')
        .addBearerAuth()
        .build(),
    ) as unknown as Doc;
  });

  afterAll(async () => {
    await app.close();
  });

  const schema = (name: string) => {
    const s = doc.components.schemas[name];
    expect(s, `schema ${name}`).toBeDefined();
    return s;
  };
  const props = (name: string) => Object.keys(schema(name).properties ?? {});

  it('describes the new manager actions and counters', () => {
    expect(doc.paths['/api/v1/admin/requests/{id}/reject']?.post).toBeDefined();
    expect(doc.paths['/api/v1/admin/requests/counts']?.get).toBeDefined();
    expect(doc.paths['/api/v1/admin/requests']?.get).toBeDefined();
  });

  it('describes the queue fields of a request', () => {
    expect(props('RequestViewDto')).toEqual(
      expect.arrayContaining(['awaitingReply', 'lastMessage', 'unreadCount']),
    );
    expect(props('LastMessageDto')).toEqual(
      expect.arrayContaining(['type', 'text', 'hasAttachments', 'author']),
    );
    expect(props('RequestCountsDto')).toEqual(['awaitingReply', 'total']);
  });

  it('allows the REJECTED status and system messages', () => {
    const json = JSON.stringify(doc.components.schemas);
    expect(json).toContain('REJECTED');
    expect(json).toContain('SYSTEM');
    expect(schema('MessageViewDto').properties?.author?.nullable).toBe(true);
  });

  it('keeps SYSTEM out of what a user may send', () => {
    const type = (
      schema('CreateMessageDto').properties as Record<
        string,
        { enum?: string[] }
      >
    ).type;
    expect(type.enum).toEqual(['TEXT', 'VOICE']);
  });

  it('describes the status change with attachments and a comment', () => {
    expect(props('ChangeStatusDto')).toEqual(
      expect.arrayContaining([
        'step',
        'declarationNumber',
        'attachments',
        'comment',
      ]),
    );
  });

  it('describes vehicle lists: counters, link to the request, updated time', () => {
    expect(props('VehicleListDto')).toEqual(
      expect.arrayContaining(['items', 'total', 'counts']),
    );
    expect(props('VehicleCountsDto')).toEqual(
      expect.arrayContaining(['all', 'active', 'ready', 'company', 'person']),
    );
    expect(props('VehicleListItemDto')).toEqual(
      expect.arrayContaining(['requestId', 'attachmentsCount', 'updatedAt']),
    );
  });

  it('documents the list filters', () => {
    const params = (path: string) =>
      ((doc.paths[path].get.parameters ?? []) as { name: string }[]).map(
        (p) => p.name,
      );
    expect(params('/api/v1/vehicles')).toEqual(
      expect.arrayContaining(['search', 'state', 'limit', 'offset']),
    );
    expect(params('/api/v1/admin/vehicles')).toEqual(
      expect.arrayContaining(['search', 'state', 'ownerType', 'vin']),
    );
    expect(params('/api/v1/admin/requests')).toEqual(
      expect.arrayContaining(['awaiting', 'status', 'clientId']),
    );
  });

  it('does not expose the signed file links as API operations', () => {
    expect(Object.keys(doc.paths).some((p) => p.includes('/files/'))).toBe(
      false,
    );
  });
});
