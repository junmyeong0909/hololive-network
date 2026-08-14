#!/usr/bin/env node
/**
 * 팔레트 PNG의 흰 배경을 투명하게 만든다 (누끼).
 *
 * imgs/background/images.png 는 colorType 3(팔레트)에 tRNS 청크가 없어서
 * 흰 배경이 그대로 사각형으로 보인다.
 *
 * 흰색만 alpha=0으로 잘라내면(이진 투명) 안티앨리어싱된 가장자리 픽셀이
 * 불투명하게 남아, 어두운 배경에서 밝은 계단 모양으로 드러난다.
 * 그래서 항목마다 "흰색에서 얼마나 떨어져 있는가"에 비례하는 중간 알파를 주고,
 * 흰색과 섞인 만큼 색을 되돌린다(un-matte).
 *
 *   관측색 = 원래색 * a + 흰색 * (1 - a)
 *   → a = (255 - min(R,G,B)) / (255 - 가장 진한 항목의 min)
 *   → 원래색 = (관측색 - 255 * (1 - a)) / a
 *
 * 원본은 건드리지 않는다.
 *
 * 사용법: node scripts/make-logo-transparent.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'imgs/background/images.png');
const OUT = resolve(ROOT, 'public/bg/hololive-mark.png');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** PNG를 청크 배열로 분해 */
function parseChunks(buf) {
  const chunks = [];
  let off = 8; // 시그니처
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

const src = readFileSync(SRC);
if (src.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG가 아닙니다');

const colorType = src[25];
if (colorType !== 3) {
  throw new Error(`팔레트 PNG(colorType 3)가 아닙니다. 실제: ${colorType}`);
}

const chunks = parseChunks(src);
const plte = chunks.find((c) => c.type === 'PLTE');
if (!plte) throw new Error('PLTE 청크가 없습니다');

const entryCount = plte.data.length / 3;
const palette = [];
for (let i = 0; i < entryCount; i++) {
  palette.push({
    r: plte.data[i * 3],
    g: plte.data[i * 3 + 1],
    b: plte.data[i * 3 + 2],
  });
}

// 가장 진한(= 흰색에서 가장 먼) 항목을 기준으로 알파를 정규화한다
const coverage = palette.map((c) => 255 - Math.min(c.r, c.g, c.b));
const maxCoverage = Math.max(...coverage);
if (maxCoverage === 0) throw new Error('팔레트가 전부 흰색입니다');

const alpha = Buffer.alloc(entryCount, 255);
const newPlte = Buffer.from(plte.data);

let fullyTransparent = 0;
let partial = 0;

for (let i = 0; i < entryCount; i++) {
  const a = Math.round((coverage[i] / maxCoverage) * 255);
  alpha[i] = a;

  if (a === 0) {
    fullyTransparent++;
    continue;
  }
  if (a < 255) partial++;

  // 흰색과 섞인 만큼 되돌린다 (a로 나누므로 a가 작을수록 보정이 커진다)
  const f = a / 255;
  const unmatte = (v) => Math.max(0, Math.min(255, Math.round((v - 255 * (1 - f)) / f)));
  newPlte[i * 3] = unmatte(palette[i].r);
  newPlte[i * 3 + 1] = unmatte(palette[i].g);
  newPlte[i * 3 + 2] = unmatte(palette[i].b);
}

plte.data = newPlte;

// 기존 tRNS는 버리고 새로 만든다. tRNS는 PLTE 뒤, IDAT 앞에 와야 한다.
const out = [Buffer.from(src.subarray(0, 8))];
for (const c of chunks) {
  if (c.type === 'tRNS') continue;
  out.push(makeChunk(c.type, c.data));
  if (c.type === 'PLTE') out.push(makeChunk('tRNS', alpha));
}

writeFileSync(OUT, Buffer.concat(out));

console.log(`팔레트 ${entryCount}개: 완전투명 ${fullyTransparent} / 반투명 ${partial} / 불투명 ${entryCount - fullyTransparent - partial}`);
console.log(`저장: ${OUT}`);
