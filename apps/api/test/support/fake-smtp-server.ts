import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

export interface ReceivedMail {
  readonly from: string;
  readonly recipients: string[];
  /** The raw message as the server received it, headers and body. */
  readonly data: string;
}

/**
 * Just enough of SMTP (no TLS, no AUTH) for a test: records each message. With `stall` it accepts
 * the connection but never sends a greeting, like a server that has hung.
 */
export class FakeSmtpServer {
  readonly received: ReceivedMail[] = [];
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: { stall?: boolean } = {}) {}

  async start(): Promise<number> {
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => undefined);
      if (!this.options.stall) this.talk(socket);
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    return (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      if (this.server === undefined) resolve();
      else this.server.close(() => resolve());
    });
  }

  private talk(socket: Socket): void {
    let from = '';
    let recipients: string[] = [];
    let data: string[] | undefined;
    let buffer = '';
    socket.write('220 fake.smtp ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      for (let end = buffer.indexOf('\r\n'); end !== -1; end = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data !== undefined) {
          if (line === '.') {
            this.received.push({ from, recipients, data: data.join('\r\n') });
            data = undefined;
            socket.write('250 2.0.0 queued\r\n');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        const command = line.slice(0, 4).toUpperCase();
        if (command === 'EHLO' || command === 'HELO') socket.write('250 fake.smtp\r\n');
        else if (command === 'MAIL') {
          from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          recipients = [];
          socket.write('250 ok\r\n');
        } else if (command === 'RCPT') {
          recipients.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
          socket.write('250 ok\r\n');
        } else if (command === 'DATA') {
          data = [];
          socket.write('354 go ahead\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 bye\r\n');
        } else socket.write('250 ok\r\n');
      }
    });
  }
}
