/**
 * 音频路由模块
 * 
 * 提供分镜语音合成（TTS）功能，支持单条分镜语音生成和批量分镜语音生成。
 * 根据 tts_kind 参数区分对白（dialogue）和旁白（narration）两种模式，
 * 分别保存到不同的字段：对白保存到 audio_local_path，旁白保存到 narration_audio_local_path。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {object} 音频路由处理函数集合
 */
const response = require('../response');
const path = require('path');

function routes(db, log, cfg) {
  /**
   * 获取本地存储路径
   * 
   * 优先使用传入的 cfg 配置，若未提供则动态加载配置文件。
   * 将相对路径转换为绝对路径。
   * 
   * @returns {string} 本地存储绝对路径
   */
  function getStoragePath() {
    const loadConfig = require('../config').loadConfig;
    const c = (cfg && cfg.storage) ? cfg : loadConfig();
    return path.isAbsolute(c.storage?.local_path)
      ? c.storage.local_path
      : path.join(process.cwd(), c.storage?.local_path || './data/storage');
  }

  return {
    /**
     * 为单条分镜生成 TTS（语音合成）
     * 
     * 根据 tts_kind 参数区分对白和旁白模式：
     * - dialogue（默认）：从分镜的 dialogue 字段提取文本，合成后保存到 audio_local_path
     * - narration：从分镜的 narration 字段提取文本，合成后保存到 narration_audio_local_path
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number} [req.body.storyboard_id] - 分镜 ID（可选，若提供则从数据库读取文本）
     * @param {string} [req.body.text] - 待合成文本（可选，若提供则直接使用）
     * @param {string} [req.body.tts_kind='dialogue'] - 语音类型：'dialogue'（对白）或 'narration'（旁白）
     * @returns {object} 合成结果（包含本地路径和 URL）
     */
    extract: async (req, res) => {
      const { storyboard_id, text, tts_kind } = req.body || {};
      if (!text && !storyboard_id) return response.badRequest(res, '请提供 storyboard_id 或 text');
      const kind = String(tts_kind || 'dialogue').toLowerCase() === 'narration' ? 'narration' : 'dialogue';
      let ttsText = text;
      if (kind === 'narration') {
        if ((!ttsText || !String(ttsText).trim()) && storyboard_id) {
          const row = db.prepare('SELECT narration FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboard_id));
          ttsText = row?.narration;
        }
        if (!ttsText || !String(ttsText).trim()) {
          return response.badRequest(res, '分镜解说旁白为空，无法合成语音');
        }
      } else {
        if ((!ttsText || !String(ttsText).trim()) && storyboard_id) {
          const row = db.prepare('SELECT dialogue FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboard_id));
          ttsText = row?.dialogue;
        }
        if (!ttsText || !String(ttsText).trim()) {
          return response.badRequest(res, '分镜对白为空，无法合成语音');
        }
      }
      try {
        const ttsService = require('../services/ttsService');
        const result = await ttsService.synthesize(db, log, {
          text: ttsText,
          storyboard_id: storyboard_id || null,
          storage_base: getStoragePath(),
        });
        if (storyboard_id && result.local_path) {
          const now = new Date().toISOString();
          try {
            if (kind === 'narration') {
              db.prepare('UPDATE storyboards SET narration_audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, Number(storyboard_id)
              );
            } else {
              db.prepare('UPDATE storyboards SET audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, Number(storyboard_id)
              );
            }
          } catch (_) {}
        }
        response.success(res, { local_path: result.local_path, url: result.local_path ? '/static/' + result.local_path : '', tts_kind: kind });
      } catch (err) {
        log.error('audio extract', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /**
     * 批量为多条分镜生成 TTS（语音合成）
     * 
     * 遍历指定的分镜 ID 列表，逐一为每个分镜的对白（dialogue）字段生成语音。
     * 每个分镜独立处理，单个失败不影响其他分镜。
     * 
     * @param {object} req - Express 请求对象
     * @param {object} res - Express 响应对象
     * @param {number[]} req.body.storyboard_ids - 分镜 ID 列表
     * @returns {object[]} 批量合成结果列表（每个元素包含 storyboard_id 和结果/错误信息）
     */
    extractBatch: async (req, res) => {
      const { storyboard_ids } = req.body || {};
      if (!Array.isArray(storyboard_ids) || storyboard_ids.length === 0) {
        return response.badRequest(res, 'storyboard_ids 不能为空');
      }
      const results = [];
      const storagePath = getStoragePath();
      for (const sbId of storyboard_ids) {
        const row = db.prepare('SELECT id, dialogue FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(sbId));
        if (!row || !row.dialogue?.trim()) {
          results.push({ storyboard_id: sbId, error: '对白为空' });
          continue;
        }
        try {
          const ttsService = require('../services/ttsService');
          const result = await ttsService.synthesize(db, log, {
            text: row.dialogue,
            storyboard_id: row.id,
            storage_base: storagePath,
          });
          if (result.local_path) {
            const now = new Date().toISOString();
            try {
              db.prepare('UPDATE storyboards SET audio_local_path = ?, updated_at = ? WHERE id = ?').run(
                result.local_path, now, row.id
              );
            } catch (_) {}
          }
          results.push({ storyboard_id: sbId, local_path: result.local_path });
        } catch (err) {
          results.push({ storyboard_id: sbId, error: err.message });
        }
      }
      response.success(res, results);
    },
  };
}

module.exports = routes;
