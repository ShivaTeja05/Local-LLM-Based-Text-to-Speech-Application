import { SseParser } from './sse-parser';

describe('SseParser', () => {
  it('parses complete events', () => {
    const p = new SseParser();
    const out = p.feed('event: token\ndata: {"t":"Hi"}\n\nevent: done\ndata: {"text":"Hi"}\n\n');
    expect(out).toEqual([
      { event: 'token', data: '{"t":"Hi"}' },
      { event: 'done', data: '{"text":"Hi"}' },
    ]);
  });

  it('buffers events split across chunks at any point', () => {
    const p = new SseParser();
    const full = 'event: token\ndata: {"t":"Lovely"}\n\n';
    const events = [];
    for (const ch of full) events.push(...p.feed(ch));
    expect(events).toEqual([{ event: 'token', data: '{"t":"Lovely"}' }]);
  });

  it('handles CRLF, comments, default event name and multi-line data', () => {
    const p = new SseParser();
    const out = p.feed(': keep-alive\r\n\r\ndata: line one\r\ndata: line two\r\n\r\n');
    expect(out).toEqual([{ event: 'message', data: 'line one\nline two' }]);
  });

  it('keeps an unfinished event for the next chunk', () => {
    const p = new SseParser();
    expect(p.feed('event: token\ndata: {"t":"a"}\n')).toEqual([]);
    expect(p.feed('\n')).toEqual([{ event: 'token', data: '{"t":"a"}' }]);
  });
});
