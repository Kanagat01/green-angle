import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { LogPushSender, WebPushSender } from './push-sender.js';

vi.mock('web-push', () => ({
  default: { sendNotification: vi.fn() },
}));

const send = vi.mocked(webpush.sendNotification);

const config = new ConfigService({
  VAPID_PUBLIC_KEY: 'public-key-public-key-public-key',
  VAPID_PRIVATE_KEY: 'private-key-private-key-private-key',
  VAPID_SUBJECT: 'mailto:ops@example.com',
});
const target = {
  endpoint: 'https://push.example.test/abc',
  p256dh: 'p',
  auth: 'a',
};
const payload = {
  title: 'HUATECH',
  body: 'Новое сообщение',
  url: 'https://app.example.com/requests/1',
  requestId: '1',
  tag: 'request-1',
};

describe('WebPushSender', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('sends the payload with the VAPID details and a one-day lifetime', async () => {
    send.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const sender = new WebPushSender(config);

    expect(sender.enabled).toBe(true);
    expect(sender.publicKey).toBe('public-key-public-key-public-key');
    expect(await sender.send(target, payload)).toBe('sent');

    const [subscription, body, options] = send.mock.calls[0];
    expect(subscription).toEqual({
      endpoint: target.endpoint,
      keys: { p256dh: 'p', auth: 'a' },
    });
    expect(JSON.parse(body as string)).toEqual(payload);
    expect(options).toMatchObject({
      TTL: 86_400,
      vapidDetails: {
        subject: 'mailto:ops@example.com',
        publicKey: 'public-key-public-key-public-key',
        privateKey: 'private-key-private-key-private-key',
      },
    });
  });

  it.each([404, 410])(
    'treats %i as a subscription that is gone',
    async (statusCode) => {
      send.mockRejectedValue(Object.assign(new Error('gone'), { statusCode }));
      expect(await new WebPushSender(config).send(target, payload)).toBe(
        'gone',
      );
    },
  );

  it.each([400, 429, 500, undefined])(
    'treats %s and network errors as a failure that keeps the subscription',
    async (statusCode) => {
      send.mockRejectedValue(Object.assign(new Error('nope'), { statusCode }));
      expect(await new WebPushSender(config).send(target, payload)).toBe(
        'failed',
      );
    },
  );
});

describe('LogPushSender', () => {
  it('is disabled, remembers what it was asked to send and can imitate answers', async () => {
    const sender = new LogPushSender();
    expect(sender.enabled).toBe(false);
    expect(sender.publicKey).toBeNull();

    expect(await sender.send(target, payload)).toBe('sent');
    sender.result = () => 'gone';
    expect(await sender.send(target, payload)).toBe('gone');
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[0]).toEqual({ target, payload });
  });

  it('keeps only the latest 500', async () => {
    Logger.overrideLogger(false);
    const sender = new LogPushSender();
    for (let i = 0; i < 510; i++) {
      await sender.send(
        { ...target, endpoint: `https://push.example.test/${i}` },
        payload,
      );
    }
    expect(sender.sent).toHaveLength(500);
    expect(sender.sent[0].target.endpoint).toBe('https://push.example.test/10');
  });
});
