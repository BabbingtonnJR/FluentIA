import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { baseName, mangaOrder, parseMokuro } from './mokuro';
import { readZip } from './zip';

/** A minimal zip with stored and deflated files, as zip tools write them. */
function makeZip(files: { name: string; data: Uint8Array; deflate: boolean }[]): ArrayBuffer {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const body = f.deflate ? new Uint8Array(deflateRawSync(f.data)) : f.data;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, f.deflate ? 8 : 0, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, f.deflate ? 8 : 0, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out.buffer;
}

describe('readZip', () => {
  it('lists files and unpacks stored and deflated entries', async () => {
    const text = new TextEncoder().encode('{"pages":[]}'.repeat(20));
    const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const zip = readZip(
      makeZip([
        { name: 'vol1/001.jpg', data: img, deflate: false },
        { name: 'vol1.mokuro', data: text, deflate: true },
      ]),
    );
    expect(zip.map((f) => f.name)).toEqual(['vol1/001.jpg', 'vol1.mokuro']);
    expect(await zip[0].read()).toEqual(img);
    expect(new TextDecoder().decode(await zip[1].read())).toBe('{"pages":[]}'.repeat(20));
  });

  it('rejects files that are not zips', () => {
    expect(() => readZip(new Uint8Array(100).buffer)).toThrow('Not a zip file.');
  });
});

describe('parseMokuro', () => {
  const mokuro = JSON.stringify({
    version: '0.2.1',
    title: 'テスト',
    volume: 'vol1',
    pages: [
      {
        img_path: 'vol1/001.jpg',
        img_width: 1000,
        img_height: 1500,
        blocks: [
          { box: [100, 100, 200, 300], vertical: true, lines: ['左の', '吹き出し'] },
          { box: [700, 120, 800, 320], vertical: true, lines: ['右の吹き出し'] },
          { box: [400, 900, 500, 1000], vertical: true, lines: ['下'] },
          { box: [10, 10, 20, 20], vertical: false, lines: ['123'] },
        ],
      },
    ],
  });

  it("reads pages and joins each block's lines, dropping blocks with no Japanese", () => {
    const v = parseMokuro(mokuro);
    expect(v.title).toBe('テスト vol1');
    expect(v.pages[0].width).toBe(1000);
    expect(v.pages[0].blocks.map((b) => b.text)).toEqual(['右の吹き出し', '左の吹き出し', '下']);
  });

  it('normalises full-width OCR text and keeps one reading of a bubble found twice', () => {
    const v = parseMokuro(
      JSON.stringify({
        pages: [
          {
            img_path: 'a.jpg',
            img_width: 100,
            img_height: 100,
            blocks: [
              { box: [10, 10, 40, 40], lines: ['４極だけ'] },
              { box: [11, 10, 40, 41], lines: ['４個だけ．．．'] },
            ],
          },
        ],
      }),
    );
    expect(v.pages[0].blocks.map((b) => b.text)).toEqual(['4個だけ…']);
  });

  it('orders bubbles in a row right to left, rows top to bottom', () => {
    const b = (x: number, y: number) => ({ box: [x, y, x + 50, y + 50] as [number, number, number, number] });
    expect(mangaOrder([b(0, 0), b(500, 10), b(0, 900)], 1000).map((x) => x.box[0])).toEqual([500, 0, 0]);
  });

  it('matches images by file name', () => {
    expect(baseName('vol1/sub/001.JPG')).toBe('001.jpg');
    expect(baseName('C:\\manga\\002.png')).toBe('002.png');
  });

  it('rejects other JSON', () => {
    expect(() => parseMokuro('{"a":1}')).toThrow('mokuro');
  });
});
