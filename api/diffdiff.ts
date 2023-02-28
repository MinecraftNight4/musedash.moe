import { isMainThread, Worker, parentPort } from 'node:worker_threads'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { characterSkip, elfinSkip } from './config.js'
import { MusicData, MusicCore } from './type.js'

import { rank as rankDB, putDiffDiff, playerDiff, getDiffDiff, putDIffDiffMusic, isWeekOldSong, insertPlayerDiffHistory, setPlayerDiffRank, player, tuneName } from './database.js'

const worker = isMainThread ? new Worker(new URL(import.meta.url)) : undefined
const workerJobs = new Map<number, () => void>()

const dispatchJob = (instruction: WorkerInstruction) => new Promise<void>(resolve => {
  const key = Math.random()
  workerJobs.set(key, resolve)
  worker?.postMessage({ key, ...instruction })
})

const parseMusicc = (music: MusicData) => {
  const { uid, difficulty: difficulties } = music
  return difficulties.map((difficultyNum, difficulty) => {
    if (difficultyNum !== '0') {
      return { uid, difficulty, level: difficultyNum } as MusicCoreExtended
    }
  }).filter(Boolean)
}

const normalDistribution = (level: number) => {
  const u = 10
  const s = 0.8
  const p1 = -0.5 * Math.pow((level - u) / s, 2)
  const p2 = Math.pow(Math.E, p1)
  return p2 / (s * Math.sqrt(2 * Math.PI))
}

export const diffdiff = async (musics: MusicData[]) => {
  if (worker) {
    return dispatchJob({ cmd: 'diffdiff', params: [musics] })
  }
  console.log('tune', tuneName)
  const musicList = musics.map(parseMusicc).flat()
  const rankMap = new WeakMap<MusicCore, IdPercentagePairs>()
  const absoluteValueMap = new WeakMap<MusicCore, number>()
  const isWeekOld = new Map<string, boolean>()

  for (const music of musicList) {
    const { uid, difficulty } = music

    const ranks = await rankDB.get({ uid, difficulty, platform: 'all' })
    const pairs = ranks
      .filter(({ play: { elfin_uid, character_uid } }) => !characterSkip.includes(character_uid) && !elfinSkip.includes(elfin_uid))
      .map(({ platform, user: { user_id }, play: { acc } }) => [`${user_id}${platform}`, acc])
    rankMap.set(music, Object.fromEntries(pairs))
    absoluteValueMap.set(music, 0)
    if (!isWeekOld.has(uid)) {
      isWeekOld.set(uid, await isWeekOldSong(uid))
    }
  }

  for (let index = 0; index < musicList.length; index++) {
    const music = musicList[index]
    const rank = rankMap.get(music)

    for (let index2 = index + 1; index2 < musicList.length; index2++) {
      const music2 = musicList[index2];
      const rank2 = rankMap.get(music2)

      const keys = Object.keys(rank).filter(key => rank2[key] !== undefined)
      if (keys.length) {
        const sum = keys.map(key => [rank[key], rank2[key]]).map(([acc1, acc2]) => accJudge(acc1) - accJudge(acc2)).reduce((sumDiff, accDiff) => sumDiff + accDiff, 0)
        const averageDiff = sum / keys.length
        if (averageDiff > 100) {
          const log = (...w) => console.log('diffdiff error', ...w)
          log(averageDiff, { music, music2, keys })
          log('sum', sum)
          log('ranks', { rank, rank2 })
        } else {
          if (isWeekOld.get(music2.uid)) {
            absoluteValueMap.set(music, absoluteValueMap.get(music) - averageDiff)
          }
          if (isWeekOld.get(music.uid)) {
            absoluteValueMap.set(music2, absoluteValueMap.get(music2) + averageDiff)
          }
        }
      }
    }
  }

  const sortedMusicList = musicList
    .sort((a, b) => absoluteValueMap.get(b) - absoluteValueMap.get(a))
    .map(music => {
      const { uid, difficulty, level } = music
      return { uid, difficulty, level, absolute: absoluteValueMap.get(music) }
    })

  const levelAverage = {} as LevelAverage
  let questionCount = 0
  sortedMusicList.forEach(({ level }) => {
    if (!Number.isNaN(Number(level))) {
      levelAverage[level] = levelAverage[level] || { count: 0, level: Number(level) }
      levelAverage[level].count += 1
    } else {
      questionCount++
    }
  })

  const levels = Object.keys(levelAverage).map(Number).sort((a, b) => b - a)
  const indexes = Object.values(levelAverage)
    .sort(({ level: a }, { level: b }) => b - a)
    .map(({ count, level }) => questionCount * normalDistribution(level) + count)
    .reduce(([last, ...counts], count) => ([last + count, last, ...counts]), [0])
    .reverse()
  const maxLevel = Math.max(...levels)

  const levelsInclude = [maxLevel + 0.5, ...levels, 0]
  const indexesInclude = [...indexes, sortedMusicList.length]

  const interpolate = (x: number) => {
    const i = indexesInclude.findIndex(index => x < index)
    const index1 = indexesInclude[i - 1]
    const index2 = indexesInclude[i]
    const level1 = levelsInclude[i - 1]
    const level2 = levelsInclude[i]
    return level1 + (level2 - level1) * (x - index1) / (index2 - index1)
  }

  const diffDiff = sortedMusicList.map((music, i) => ({ ...music, relative: interpolate(i) } as MusicDiffDiff))
  await putDiffDiff(diffDiff)
  for (const { relative, absolute, ...music } of diffDiff) {
    await putDIffDiffMusic(music, { relative, absolute })
  }
  await writeFile(`tune-${tuneName}-diffdiff.json`, JSON.stringify(diffDiff, null, 2))
}

const accJudge = (acc: number, param1 = 0.36) => {
  const factor = acc / 100
  if (factor === 1) {
    return 1
  }
  const result = factor - Math.pow(factor, 2) + Math.pow(factor, 4)
  return result * param1
}

const accJudgePlayerRL = (acc: number) => accJudge(acc, 1)

export const diffPlayer = async () => {
  if (worker) {
    return dispatchJob({ cmd: 'diffPlayer', params: [] })
  }
  const diffDiff = await getDiffDiff()
  const diffDiffMap = {} as Record<string, number[]>
  for (const { uid, difficulty, relative } of diffDiff) {
    if (!diffDiffMap[uid]) {
      diffDiffMap[uid] = []
    }
    if (await isWeekOldSong(uid)) {
      diffDiffMap[uid][difficulty] = relative
    } else {
      diffDiffMap[uid][difficulty] = 0
    }
  }

  const batch = playerDiff.batch()
  const playerDiffs = [] as { id: string, rl: number }[]

  for await (const [id, { plays }] of player.iterator()) {
    const accMap = {} as Record<string, number[]>
    plays
      .filter(({ character_uid, elfin_uid }) => !characterSkip.includes(character_uid) && !elfinSkip.includes(elfin_uid))
      .forEach(({ uid, difficulty, acc }) => {
        if (!accMap[uid]) {
          accMap[uid] = []
        }
        if (accMap[uid][difficulty] === undefined) {
          accMap[uid][difficulty] = acc
        } else {
          accMap[uid][difficulty] = Math.max(accMap[uid][difficulty], acc)
        }
      })

    const rl = Object.entries(accMap)
      .flatMap(([uid, accs]) => accs.map((acc, difficulty) => ({ uid, difficulty, acc })))
      .filter(({ acc }) => acc !== undefined)
      .map(({ uid, difficulty, acc }) => accJudgePlayerRL(acc) * diffDiffMap[uid][difficulty])
      .sort((a, b) => a - b)
      .reduce((r, a) => a + r * 0.8, 0) / 5

    batch.put(id, rl)
    playerDiffs.push({ id, rl })
  }

  await playerDiff.clear()
  await batch.write()

  const playerDiffsRank = playerDiffs.sort((a, b) => b.rl - a.rl)
  await setPlayerDiffRank(playerDiffsRank)
  const playerDiffsRanked = playerDiffsRank.map((w, i) => ({ ...w, rank: i + 1 }))
  for (const { id, rl, rank } of playerDiffsRanked) {
    await insertPlayerDiffHistory(id, rl, rank)
  }
  await writeFile(`tune-${tuneName}-playerdiff.json`, JSON.stringify(playerDiffsRank, null, 2))
}

if (!worker) {
  parentPort.on('message', async (message: WorkerCommand) => {
    if (message.cmd === 'diffdiff') {
      await diffdiff(...message.params)
    } else if (message.cmd === 'diffPlayer') {
      await diffPlayer(...message.params)
    }
    parentPort.postMessage(message.key)
  })
} else {
  worker.on('message', (key: number) => {
    const resolve = workerJobs.get(key)
    if (resolve) {
      resolve()
      workerJobs.delete(key)
    }
  })
}

type IdPercentagePairs = Record<string, number>

type MusicCoreExtended = MusicCore & {
  level: string
}

export type DiffDiffResult = {
  absolute: number
  relative: number
}

export type MusicDiffDiff = MusicCoreExtended & DiffDiffResult

type LevelAverage = Record<string, { count: number, level: number }>

type WorkerInstruction = {
  cmd: 'diffdiff'
  params: [MusicData[]]
} | {
  cmd: 'diffPlayer'
  params: []
}

type WorkerCommand = WorkerInstruction & {
  key: number
}
