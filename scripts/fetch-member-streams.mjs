#!/usr/bin/env node
/**
 * 멤버별 지난 라이브 방송 기록을 모아 src/data/memberStreams.json에 저장한다.
 * Worker가 KV 아카이브를 처음 만들 때 이 파일을 시드로 쓴다.
 *
 * 곡(music_cover/original_song) 영상은 이미 setup:songs가 별도로 모으므로 제외하고,
 * 실제 방송(type=stream)만 담는다. 판정 방식은 Worker의 toNotification()과 동일하다.
 *
 * 사용법:
 *   npm run setup:streams
 *   → 키를 물어본다. 환경변수 HOLODEX_API_KEY가 있으면 그걸 쓴다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHANNELS_PATH = resolve(ROOT, 'src/data/channelIds.json');
const OUT_PATH = resolve(ROOT, 'src/data/memberStreams.json');

const API = 'https://holodex.net/api/v2';
const PER_MEMBER = 100;

const MUSIC_TOPICS = new Set(['music_cover', 'original_song']);
const EXCLUDED_TOPICS = new Set(['freechat', 'freetalk']);
const INSTRUMENTAL = /instrumental|off\s*vocal|inst\.?\s*ver|카라오케\s*ver/i;

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (chunk) {
      if (rl.stdoutMuted && chunk !== question) rl.output.write('*');
      else rl.output.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.stdoutMuted = false;
      rl.output.write('\n');
      rl.close();
      process.stdin.pause();
      resolve(answer.trim());
    });
    rl.stdoutMuted = true;
  });
}

let KEY = process.env.HOLODEX_API_KEY;

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-APIKEY': KEY } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!KEY) KEY = await askHidden('Holodex API 키를 붙여넣고 Enter: ');
  if (!KEY) {
    console.error('키가 입력되지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  const channels = JSON.parse(readFileSync(CHANNELS_PATH, 'utf-8'));
  const entries = Object.entries(channels);

  console.log(`멤버 ${entries.length}명의 지난 방송 ${PER_MEMBER}개씩을 모읍니다...\n`);

  const byId = new Map();
  let scanned = 0;

  for (const [memberId, channelId] of entries) {
    try {
      const vids = await api(
        `/videos?channel_id=${channelId}&status=past&type=stream&limit=${PER_MEMBER}` +
          `&sort=available_at&order=desc`
      );
      const list = Array.isArray(vids) ? vids : [];
      scanned += list.length;

      let found = 0;
      for (const v of list) {
        const topicId = String(v.topic_id ?? '').toLowerCase();
        if (EXCLUDED_TOPICS.has(topicId)) continue;

        const title = v.title ?? '';
        const isMusic = MUSIC_TOPICS.has(topicId) && !INSTRUMENTAL.test(title);
        if (isMusic) continue; // 곡은 setup:songs가 담당

        const id = `yt:${v.id}`;
        if (byId.has(id)) continue;

        byId.set(id, {
          id,
          memberId,
          type: 'stream',
          status: 'past',
          title,
          snippet: topicId ? topicId.replace(/_/g, ' ') : '',
          timestamp: v.start_actual ?? v.available_at ?? v.published_at ?? '',
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
        });
        found += 1;
      }

      console.log(`  ${memberId.padEnd(10)} 방송 ${String(list.length).padStart(3)}개 중 ${found}건 저장`);
    } catch (e) {
      console.log(`  ${memberId.padEnd(10)} 실패: ${e.message}`);
    }

    await sleep(100); // API에 부담 주지 않도록
  }

  const streams = [...byId.values()].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  writeFileSync(OUT_PATH, JSON.stringify(streams, null, 2) + '\n', 'utf-8');

  console.log(`\n방송 ${scanned}개 조회 → 지난 라이브 ${streams.length}건 저장`);
  console.log(`저장: ${OUT_PATH}`);
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exitCode = 1;
});
