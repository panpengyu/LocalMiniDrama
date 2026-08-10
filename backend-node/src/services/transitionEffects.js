'use strict';
/**
 * transitionEffects.js
 * Sprint 7 — S7-T06 转场效果库
 *
 * 6 种转场效果，通过 ffmpeg 滤镜实现：
 *   hard_cut / fade / dissolve / slide / zoom / rotate
 *
 * 每种效果提供 ffmpeg xfilter 参数，用于视频拼接时的片段间转场。
 */

const TRANSITIONS = {
  hard_cut: {
    name: '硬切',
    description: '直接切换，无过渡效果',
    duration: 0,
    // ffmpeg: 直接 concat，无滤镜
    getFilter: () => null,
  },
  fade: {
    name: '淡入淡出',
    description: '前一段淡出黑屏，后一段从黑屏淡入',
    duration: 0.5,
    // 使用 fade=in/out 滤镜
    getFilter: (offset, duration) => ({
      type: 'fade',
      params: `t=out:st=${offset}:d=0.5:t=black`,
      inParams: `t=in:st=0:d=0.5:t=black`,
    }),
  },
  dissolve: {
    name: '叠化',
    description: '前一段逐渐透明，后一段逐渐显现，两段画面交叉过渡',
    duration: 0.5,
    // 使用 xfade=transition=dissolve
    getFilter: (offset, duration) => ({
      type: 'xfade',
      params: `transition=dissolve:duration=0.5:offset=${offset - 0.5}`,
    }),
  },
  slide: {
    name: '滑动',
    description: '后一段从右侧滑入，前一段向左滑出',
    duration: 0.5,
    getFilter: (offset, duration) => ({
      type: 'xfade',
      params: `transition=slideleft:duration=0.5:offset=${offset - 0.5}`,
    }),
  },
  zoom: {
    name: '缩放',
    description: '前一段缩小消失，后一段放大出现',
    duration: 0.5,
    getFilter: (offset, duration) => ({
      type: 'xfade',
      params: `transition=zoomin:duration=0.5:offset=${offset - 0.5}`,
    }),
  },
  rotate: {
    name: '旋转',
    description: '画面旋转切换，3D 翻转效果',
    duration: 0.5,
    getFilter: (offset, duration) => ({
      type: 'xfade',
      params: `transition=radial:duration=0.5:offset=${offset - 0.5}`,
    }),
  },
};

/**
 * 获取所有转场效果
 */
function listTransitions() {
  return Object.entries(TRANSITIONS).map(([key, val]) => ({
    key,
    name: val.name,
    description: val.description,
    duration: val.duration,
  }));
}

/**
 * 获取转场效果
 */
function getTransition(key) {
  return TRANSITIONS[key] || null;
}

/**
 * 为剪辑任务构建 ffmpeg 转场参数
 * @param {Array} clips - 片段数组 [{duration, transition_type}]
 * @returns {object} { filterComplex, concatInputs }
 */
function buildTransitionFilter(clips) {
  if (!clips || clips.length === 0) return { filterComplex: '', inputs: 0 };

  // 单片段无需转场
  if (clips.length === 1) return { filterComplex: '[0:v]format=yuv420p[v]', inputs: 1 };

  const filters = [];
  let totalOffset = 0;
  const transitionDuration = 0.5;

  // 计算每段的时间偏移
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const transitionKey = clip.transition_type || 'hard_cut';
    const transition = TRANSITIONS[transitionKey] || TRANSITIONS.hard_cut;

    if (i === 0) {
      // 第一段：如果下一段有转场，需要准备
      filters.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`);
    } else {
      const prevTransition = TRANSITIONS[clips[i - 1].transition_type] || TRANSITIONS.hard_cut;
      if (prevTransition.duration > 0) {
        // 使用 xfade 转场
        const offset = Math.max(0, totalOffset - transitionDuration);
        filters.push(`[v${i - 1}][${i}:v]xfade=transition=${prevTransitionKey(clips[i - 1].transition_type)}:duration=${transitionDuration}:offset=${offset}[v${i}]`);
        totalOffset += clip.duration - transitionDuration;
      } else {
        // 硬切：直接 concat
        filters.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`);
        totalOffset += clip.duration;
      }
    }
    if (i === 0) totalOffset += clip.duration;
  }

  // 拼接所有片段
  if (clips.length > 2) {
    // 多段使用 concat
    const labels = clips.map((_, i) => `[v${i}]`).join('');
    filters.push(`${labels}concat=n=${clips.length}:v=1:a=0[outv]`);
  } else {
    filters.push(`[v${clips.length - 1}]format=yuv420p[outv]`);
  }

  return {
    filterComplex: filters.join(';'),
    inputs: clips.length,
    outputLabel: 'outv',
  };
}

function prevTransitionKey(key) {
  const map = { fade: 'fadeblack', dissolve: 'dissolve', slide: 'slideleft', zoom: 'zoomin', rotate: 'radial' };
  return map[key] || 'fade';
}

module.exports = {
  TRANSITIONS,
  listTransitions,
  getTransition,
  buildTransitionFilter,
};
