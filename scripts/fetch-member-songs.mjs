#!/usr/bin/env node
/**
 * 멤버별 최신 커버/오리지널 곡을 5개씩 받아 src/data/memberSongs.json에 저장한다.
 *
 * 실시간 피드(Worker)는 최근 활동만 담기 때문에, 요즘 활동이 뜸한 멤버의 노드를
 * 클릭하면 알림 피드가 비어 버린다. 이 정적 아카이브를 함께 병합해 빈 화면을 없앤다.
 *
 * 사용법:
 *   npm run setup:songs
 *   → 키를 물어본다. 환경변수 HOLODEX_API_KEY가 있으면 그걸 쓴다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHANNELS_PATH = resolve(ROOT, 'src/data/channelIds.json');
const OUT_PATH = resolve(ROOT, 'src/data/memberSongs.json');

const API = 'https://holodex.net/api/v2';
const PER_MEMBER = 5;
const MUSIC_TOPIC = /sing|music|cover|karaoke|song/i;

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

/** Holodex 영상 → 우리 알림 스키마 (Worker의 변환과 동일한 형태) */
function toSong(v, memberId) {
  return {
    id: `yt:${v.id}`,
    memberId,
    type: 'music',
    status: 'past',
    title: v.title ?? '',
    snippet: '커버',
    timestamp: v.available_at ?? v.published_at,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
  };
}

async function main() {
  if (!KEY) KEY = await askHidden('Holodex API 키를 붙여넣고 Enter: ');
  if (!KEY) {
    console.error('키가 입력되지 않았습니다.');
    process.exitCode = 1;
    return;
  }

  const channels = JSON.parse(readFileSync(CHANNELS_PATH, 'utf-8'));
  const entries = Object.entries(channels);
  console.log(`멤버 ${entries.length}명의 음악 영상을 조회합니다...\n`);

  const songs = [];
  const noMusic = [];

  for (const [memberId, channelId] of entries) {
    try {
      // 음악 토픽으로 먼저 조회
      let vids = await api(
        `/videos?channel_id=${channelId}&topic=Music_Cover&status=past&limit=${PER_MEMBER}&sort=available_at&order=desc`
      );

      // 부족하면 최근 영상에서 음악 토픽을 추려 채운다
      if (!Array.isArray(vids) || vids.length < PER_MEMBER) {
        const recent = await api(
          `/videos?channel_id=${channelId}&status=past&limit=50&sort=available_at&order=desc`
        );
        const extra = (Array.isArray(recent) ? recent : []).filter((v) => MUSIC_TOPIC.test(v.topic_id ?? ''));
        const seen = new Set((vids ?? []).map((v) => v.id));
        for (const v of extra) {
          if (songs.length && seen.has(v.id)) continue;
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          vids.push(v);
          if (vids.length >= PER_MEMBER) break;
        }
      }

      const picked = (vids ?? []).slice(0, PER_MEMBER);
      picked.forEach((v) => songs.push(toSong(v, memberId)));

      const mark = picked.length === 0 ? '  ← 음악 없음' : '';
      console.log(`  ${memberId.padEnd(10)} ${picked.length}곡${mark}`);
      if (picked.length === 0) noMusic.push(memberId);
    } catch (e) {
      console.log(`  ${memberId.padEnd(10)} 실패: ${e.message}`);
      noMusic.push(memberId);
    }

    await sleep(120); // API에 부담 주지 않도록
  }

  // id 중복 제거 (여러 멤버가 참여한 합동 곡 등)
  const seen = new Set();
  const unique = songs.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  writeFileSync(OUT_PATH, JSON.stringify(unique, null, 2) + '\n', 'utf-8');

  console.log(`\n총 ${unique.length}곡 저장 (중복 ${songs.length - unique.length}건 제거)`);
  console.log(`저장: ${OUT_PATH}`);
  if (noMusic.length) {
    console.log(`\n음악을 못 찾은 멤버 ${noMusic.length}명: ${noMusic.join(', ')}`);
  }
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exitCode = 1;
});
