import { Writable } from 'node:stream';

export interface LogCapture {
  readonly stream: Writable;
  /** Raw text written so far. */
  text(): string;
  /** One parsed object per JSON line. */
  lines(): Record<string, unknown>[];
}

export function captureLogs(): LogCapture {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });

  return {
    stream,
    text: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
