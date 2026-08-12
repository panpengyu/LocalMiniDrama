'use strict';

/**
 * Sprint 12 - S12-T03 存储层抽象：StorageAdapter 接口
 *
 * 定义统一的对象存储读写契约，屏蔽本地磁盘 / MinIO / 阿里云 OSS / 腾讯云 COS 差异。
 * 上层业务（uploadService 等）只依赖此接口，切换后端仅需更换适配器实现。
 *
 * 相对路径约定：所有 objectKey 均为「相对存储根」的正斜杠路径（如 projects/0001_.../images/x.png），
 * 与既有 local_path 语义完全一致，保证历史数据无缝兼容。
 */
class StorageAdapter {
  /** @returns {string} 后端标识：local/minio/oss/cos */
  get backend() {
    throw new Error('StorageAdapter.backend 未实现');
  }

  /**
   * 写入对象。
   * @param {string} objectKey 相对路径键
   * @param {Buffer} buffer 内容
   * @param {object} opts { contentType }
   * @returns {Promise<{ objectKey, url, size, backend }>}
   */
  async putObject(objectKey, buffer, opts = {}) { // eslint-disable-line no-unused-vars
    throw new Error('putObject 未实现');
  }

  /**
   * 读取对象内容。
   * @param {string} objectKey
   * @returns {Promise<Buffer>}
   */
  async getObject(objectKey) { // eslint-disable-line no-unused-vars
    throw new Error('getObject 未实现');
  }

  /**
   * 删除对象。
   * @param {string} objectKey
   * @returns {Promise<boolean>}
   */
  async deleteObject(objectKey) { // eslint-disable-line no-unused-vars
    throw new Error('deleteObject 未实现');
  }

  /**
   * 判断对象是否存在。
   * @param {string} objectKey
   * @returns {Promise<boolean>}
   */
  async exists(objectKey) { // eslint-disable-line no-unused-vars
    throw new Error('exists 未实现');
  }

  /**
   * 由相对键生成可访问 URL。
   * @param {string} objectKey
   * @returns {string}
   */
  publicUrl(objectKey) { // eslint-disable-line no-unused-vars
    throw new Error('publicUrl 未实现');
  }

  /** 后端连通性自检 @returns {Promise<{ ok, backend, detail? }>} */
  async healthCheck() {
    return { ok: true, backend: this.backend };
  }
}

module.exports = StorageAdapter;
