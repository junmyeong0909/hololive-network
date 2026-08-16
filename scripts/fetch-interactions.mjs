#!/usr/bin/env node
/**
 * 멤버별 최근 방송에서 합방 기록을 추출해 src/data/memberInteractions.json에 저장한다.
 * Worker가 KV 아카이브를 처음 만들 때 이 파일을 시드로 쓴다.
 *
 * 판정 방식은 Worker와 동일하다:
 *   - 채널 단위 조회이므로 업로더가 그 멤버 본인임이 보장된다
 *     (org 전체 조회에서 팬 클립 채널이 섞이던 문제를 원천 차단)
 *   - mentions에 걸린 다른 추적 멤버를 참가자로 본다
 *   - 참가자 2명 미만이면 합방이 아니다
 *
 * 사용법:
 *   npm run setup:interactions
 *   → 키를 물어본다. 환경변수 HOLODEX_API_KEY가 있으면 그걸 쓴다.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CHANNELS_PATH = resolve(ROOT, 'src/data/channelIds.json');
const OUT_PATH = resolve(ROOT, 'src/data/memberInteractions.json');

const API = 'https://holodex.net/api/v2';
const PER_MEMBER = 100;

// 곡(커버/오리지널) 토픽이면 collab이 아니라 cover로 분류한다
const MUSIC_TOPICS = new Set(['music_cover', 'original_song']);

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
  const memberByChannel = Object.fromEntries(
    Object.entries(channels).map(([memberId, channelId]) => [channelId, memberId])
  );
  const entries = Object.entries(channels);

  console.log(`멤버 ${entries.length}명의 최근 방송 ${PER_MEMBER}개씩에서 합방을 찾습니다...\n`);

  const byId = new Map();
  let scanned = 0;

  for (const [memberId, channelId] of entries) {
    try {
      const vids = await api(
        `/videos?channel_id=${channelId}&status=past&type=stream&limit=${PER_MEMBER}` +
          `&include=mentions&sort=available_at&order=desc`
      );
      const list = Array.isArray(vids) ? vids : [];
      scanned += list.length;

      let found = 0;
      for (const v of list) {
        const participants = new Set([memberId]);
        for (const m of v.mentions ?? []) {
          const id = memberByChannel[m.id];
          if (id) participants.add(id);
        }
        if (participants.size < 2) continue;

        const id = `yt:${v.id}`;
        if (byId.has(id)) continue; // 다른 참가자 조회에서 이미 잡힌 영상

        const topicId = String(v.topic_id ?? '').toLowerCase();
        byId.set(id, {
          id,
          type: MUSIC_TOPICS.has(topicId) ? 'cover' : 'collab',
          participants: [...participants].sort(),
          count: 1,
          lastDate: String(v.available_at ?? v.published_at ?? '').slice(0, 10),
          title: v.title ?? '',
          url: `https://www.youtube.com/watch?v=${v.id}`,
        });
        found += 1;
      }

      console.log(`  ${memberId.padEnd(10)} 방송 ${String(list.length).padStart(2)}개 중 합방 ${found}건`);
    } catch (e) {
      console.log(`  ${memberId.padEnd(10)} 실패: ${e.message}`);
    }

    await sleep(100); // API에 부담 주지 않도록
  }

  const interactions = [...byId.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  writeFileSync(OUT_PATH, JSON.stringify(interactions, null, 2) + '\n', 'utf-8');

  // 요약
  const pairCount = new Map();
  for (const ev of interactions) {
    for (let i = 0; i < ev.participants.length; i++) {
      for (let j = i + 1; j < ev.participants.length; j++) {
        const key = [ev.participants[i], ev.participants[j]].sort().join('|');
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }
  const sizes = interactions.map((e) => e.participants.length);

  console.log(`\n방송 ${scanned}개 조회 → 합방 ${interactions.length}건 (중복 제거 후)`);
  console.log(`연결된 멤버 쌍: ${pairCount.size}개`);
  console.log(`  2회 이상 함께한 쌍: ${[...pairCount.values()].filter((n) => n >= 2).length}개`);
  console.log(`참가 인원 분포: 2인 ${sizes.filter((n) => n === 2).length} / 3인 ${sizes.filter((n) => n === 3).length} / 4인+ ${sizes.filter((n) => n >= 4).length}`);
  console.log(`저장: ${OUT_PATH}`);
}

main().catch((e) => {
  console.error('\n실패:', e.message);
  process.exitCode = 1;
});
