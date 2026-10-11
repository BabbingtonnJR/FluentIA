import { describe, expect, it } from 'vitest';
import { decodeSubtitles, parseSubtitles } from './subtitles';

const SRT = `1
00:00:01,000 --> 00:00:03,500
<i>おはよう</i>ございます

2
00:00:04,000 --> 00:00:06,000
今日は
いい天気ですね

3
00:00:06,000 --> 00:00:07,000
♪～
`;

const ASS = String.raw`[Script Info]
Title: test

[V4+ Styles]
Format: Name, Fontname

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:10.50,0:00:12.00,Default,,0,0,0,,{\an8}行こう、\N早く！
Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,待って、それは…
`;

describe('parseSubtitles', () => {
  it('reads SRT, dropping tags and lines with no Japanese', () => {
    expect(parseSubtitles(SRT, 'ep1.srt')).toEqual([
      { start: 1, end: 3.5, text: 'おはようございます' },
      { start: 4, end: 6, text: '今日は\nいい天気ですね' },
    ]);
  });

  it('reads WebVTT', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nこんにちは\n';
    expect(parseSubtitles(vtt, 'a.vtt')).toEqual([{ start: 1, end: 2, text: 'こんにちは' }]);
  });

  it('reads ASS dialogue in time order, with commas and line breaks in the text', () => {
    expect(parseSubtitles(ASS, 'a.ass')).toEqual([
      { start: 2, end: 4, text: '待って、それは…' },
      { start: 10.5, end: 12, text: '行こう、\n早く！' },
    ]);
  });

  it('merges a line repeated back to back', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nはい\n\n2\n00:00:02,100 --> 00:00:03,000\nはい\n';
    expect(parseSubtitles(srt)).toEqual([{ start: 1, end: 3, text: 'はい' }]);
  });
});

describe('decodeSubtitles', () => {
  it('falls back to Shift_JIS when the file is not UTF-8', () => {
    // 日本 in Shift_JIS
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b]).buffer;
    expect(decodeSubtitles(sjis)).toBe('日本');
    expect(decodeSubtitles(new TextEncoder().encode('日本').buffer as ArrayBuffer)).toBe('日本');
  });
});
