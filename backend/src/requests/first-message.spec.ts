import { firstMessageText, formatRubles } from './first-message.js';

describe('formatRubles', () => {
  it.each([
    [0, '0 ₽'],
    [999, '999 ₽'],
    [1000, '1 000 ₽'],
    [1_600_000, '1 600 000 ₽'],
    [999_999_999_999, '999 999 999 999 ₽'],
    [1500.5, '1 500,50 ₽'],
    [10.07, '10,07 ₽'],
  ])('%d → %s', (amount, expected) => {
    expect(formatRubles(amount)).toBe(expected);
  });
});

describe('firstMessageText', () => {
  it('writes the model, year and budget like the design does', () => {
    expect(
      firstMessageText({
        title: 'Haval Jolion',
        yearFrom: 2023,
        budget: 1_600_000,
      }),
    ).toBe('Новая заявка: Haval Jolion, 2023. Бюджет 1 600 000 ₽.');
  });

  it('puts the comment on a new line', () => {
    expect(
      firstMessageText({
        title: 'Li Auto L7',
        yearFrom: 2024,
        budget: 3_900_000,
        comment: 'Pro или Max, светлый салон.',
      }),
    ).toBe(
      'Новая заявка: Li Auto L7, 2024. Бюджет 3 900 000 ₽.\nPro или Max, светлый салон.',
    );
  });

  it('leaves out what was not given', () => {
    expect(firstMessageText({ title: 'Zeekr 001' })).toBe(
      'Новая заявка: Zeekr 001.',
    );
    expect(firstMessageText({ title: 'Zeekr 001', yearFrom: 2025 })).toBe(
      'Новая заявка: Zeekr 001, 2025.',
    );
    expect(firstMessageText({ title: 'Zeekr 001', budget: 2_000_000 })).toBe(
      'Новая заявка: Zeekr 001. Бюджет 2 000 000 ₽.',
    );
  });

  it('ignores a blank comment and keeps a zero budget', () => {
    expect(
      firstMessageText({ title: 'BYD', budget: 0, comment: '   \n ' }),
    ).toBe('Новая заявка: BYD. Бюджет 0 ₽.');
  });

  it('trims the comment', () => {
    expect(firstMessageText({ title: 'BYD', comment: '  без панорамы ' })).toBe(
      'Новая заявка: BYD.\nбез панорамы',
    );
  });
});
