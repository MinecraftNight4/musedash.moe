import Vue from 'vue'
import Vuex from 'vuex'
import { getAlbums, getTag, getRank, getRankUpdateTime, refreshRank, getPlayer, getCE, mdmcGetAlbum, mdmcGetPlayer, mdmcGetRank, getDiffDiff, getDiffDiffMusic } from './api'
import { set as cookieSet } from 'js-cookie'

import { loadCover } from './coverLoader'

Vue.use(Vuex)

export const createStore = ({ lang, changeTitle, theme }) => {
  const countParent = instance => instance.$parent ? 1 + countParent(instance.$parent) : 0
  let owners = []

  const updateTitle = (instance, part) => {
    const depth = countParent(instance)
    owners[depth] = instance
    changeTitle(depth, part)
  }
  const removeTitle = instance => {
    const depth = countParent(instance)
    if (!owners[depth] || owners[depth] === instance) {
      changeTitle(depth)
    }
  }

  return new Vuex.Store({
    state: {
      fullAlbums: {},
      tag: [],
      rankCache: {},
      diffDiffMusic: {},
      rankUpdateTimeCache: {},
      userCache: {},
      diffDiff: [],
      ce: { c: {}, e: {} },
      blackWhite: false,
      lang,
      theme
    },
    getters: {
      albumsArray: ({ fullAlbums }) => Object.values(fullAlbums),
      allMusics: ({ fullAlbums }) => {
        return Object.assign({}, ...Object.values(fullAlbums).map(({ music }) => music))
      },
      tagMap: ({ tag }) => Object.fromEntries(tag.map(({ name, musicList }) => [name, musicList])),
      musicAlbum: ({ fullAlbums }) => Object.fromEntries(Object.entries(fullAlbums).flatMap(([id, { music }]) => Object.keys(music).map(k => [k, id]))),
      characters: ({ ce, lang: l }) => ce.c[l] || [],
      elfins: ({ ce, lang: l }) => ce.e[l] || [],
      diffDiffMap: ({ diffDiff }) => diffDiff.reduce(({ uid, difficulty, level, absolute, relative }, result) => {
        if (!result[uid]) {
          result[uid] = []
        }
        result[uid][difficulty] = { level, absolute, relative }
        return result
      }, {}),
      diffDiffList: ({ diffDiff, fullAlbums, lang: l }, { musicAlbum, allMusics }) => diffDiff.map(({ uid, difficulty, level, absolute, relative }) => {
        const difficulties = Array(4).fill({ level: '0' })
        difficulties[difficulty] = { level, link: `/music/${uid}/${difficulty}` }

        const album = musicAlbum[uid]
        const albumName = fullAlbums[album][l].title
        const albumLink = `/albums/${album}`

        const { name, author, cover } = allMusics[uid]
        const src = loadCover(cover)
        return { uid, absolute: Math.round(absolute * 100) / 100, relative: Math.round(relative * 100) / 100, difficulties, albumName, albumLink, name, author, src }
      })
    },
    mutations: {
      setAlbums(state, data) {
        state.fullAlbums = data
      },
      setTag(state, data) {
        state.tag = data
      },
      setCE(state, ce) {
        state.ce = ce
      },
      setRank(state, { uid, difficulty, platform, rank }) {
        state.rankCache = { ...state.rankCache, [`${uid}_${platform}_${difficulty}`]: rank }
      },
      setDiffDiffMusic(state, { uid, difficulty, value }) {
        state.diffDiffMusic = { ...state.diffDiffMusic, [`${uid}_${difficulty}`]: value }
      },
      setRankUpdateTime(state, { uid, difficulty, platform, updateTime }) {
        state.rankUpdateTimeCache = { ...state.rankUpdateTimeCache, [`${uid}_${platform}_${difficulty}`]: updateTime }
      },
      setUser(state, { id, data }) {
        state.userCache = { ...state.userCache, [id]: data }
      },
      setLang(state, data) {
        cookieSet('lang', data)
        state.lang = data
      },
      setTheme(state, data) {
        cookieSet('theme', data)
        state.theme = data
      },
      updateTitle(_state, [instance, part]) {
        updateTitle(instance, part)
      },
      removeTitle(_state, instance) {
        removeTitle(instance)
      },
      setDiffDiff(state, data) {
        state.diffDiff = data
      },
      setBlackWhite(state, data) {
        state.blackWhite = data
      }
    },
    actions: {
      async loadAlbums({ commit, dispatch }) {
        const ceP = dispatch('loadCE')
        const albumsP = getAlbums()
        const tagP = getTag()
        await ceP
        commit('setAlbums', await albumsP)
        commit('setTag', await tagP)
      },
      async loadCE({ commit, state }) {
        if (!Object.keys(state.ce.c).length) {
          commit('setCE', await getCE())
        }
      },
      async loadDiffDiffMusic({ commit }, { uid, difficulty }) {
        commit('setDiffDiffMusic', { uid, difficulty, value: await getDiffDiffMusic({ uid, difficulty }) })
      },
      async loadRank({ commit, state, dispatch }, { uid, difficulty, platform }) {
        const defer = []
        if (!state.diffDiffMusic[`${uid}_${difficulty}`]) {
          defer.push(dispatch('loadDiffDiffMusic', { uid, difficulty }))
        }
        commit('setRank', { uid, difficulty, platform, rank: await getRank({ uid, difficulty, platform }) })
        commit('setRankUpdateTime', { uid, difficulty, platform, updateTime: await getRankUpdateTime({ uid, difficulty, platform }) })
        await Promise.all(defer)
      },
      async updateRank({ commit, dispatch }, { uid, difficulty, platform }) {
        commit('setRankUpdateTime', { uid, difficulty, platform, updateTime: 0 })
        await refreshRank({ uid, difficulty, platform })
        await dispatch('loadRank', { uid, difficulty, platform })
      },
      async loadUser({ commit }, id) {
        commit('setUser', { id, data: await getPlayer(id) })
      },
      async loadDiffDiff({ commit }) {
        commit('setDiffDiff', await getDiffDiff())
      }
    },
    modules: {
      mdmc: {
        namespaced: true,
        state: {
          album: [],
          rankCache: {},
          userCache: {}
        },
        getters: {
          songs: ({ album }) => Object.fromEntries(album.map(({ id, ...rest }) => [id, { ...rest, id }]))
        },
        mutations: {
          setAlbum(state, data) {
            state.album = data
          },
          setRank(state, { id, difficulty, rank }) {
            state.rankCache = { ...state.rankCache, [`${id}_${difficulty}`]: rank }
          },
          setUser(state, { id, data }) {
            state.userCache = { ...state.userCache, [id]: data }
          }
        },
        actions: {
          async loadAlbum({ commit, dispatch }) {
            const ceP = dispatch('loadCE', null, { root: true })
            const albumP = mdmcGetAlbum()
            await ceP
            commit('setAlbum', await albumP)
          },
          async loadRank({ commit }, { id, difficulty, }) {
            commit('setRank', { id, difficulty, rank: await mdmcGetRank({ id, difficulty }) })
          },
          async loadUser({ commit }, id) {
            commit('setUser', { id, data: await mdmcGetPlayer(id) })
          }
        }
      }
    }
  })
}
