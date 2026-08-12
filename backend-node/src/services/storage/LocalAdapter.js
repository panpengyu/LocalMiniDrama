'use strict';

/**
 * Sprint 12 - S12-T03 本地磁盘存储适配器
 *
 * 封装既有本地文件系统读写逻辑（与 uploadService 中的写盘方式完全一致），
 * 作为默认后端，保证在未配置任何对象存储时系统完整可用。
 */
const fs = require('fs');
const path = require('path');
const StorageAdapter = require('./StorageAdapter');

class LocalAdapter extends StorageAdapter {
  /**
   * @param {object} opts { root: 存储根绝对路径, baseUrl: 静态访问前缀 }
   */
  constructor({ root, baseUrl }) {
    super();
    this.root = root;
    this.baseUrl = (baseUrl || '/static').replace(/\/$/, '');
  }

  get backend() {
    return 'local';
  }

  _absPath(objectKey) {
    const key = String(objectKey || '').replace(/^\/+/, '').replace(/\\/g, '/');
    return path.join(this.root, key);
  }

  async putObject(objectKey, buffer, opts = {}) {
    const abs = this._absPath(objectKey);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    return {
      objectKey: String(objectKey).replace(/\\/g, '/'),
      url: this.publicUrl(objectKey),
      size: buffer.length,
      backend: this.backend,
      contentType: opts.contentType || null,
    };
  }

  async getObject(objectKey) {
    return fs.readFileSync(this._absPath(objectKey));
  }

  async deleteObject(objectKey) {
    const abs = this._absPath(objectKey);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
    return false;
  }

  async exists(objectKey) {
    return fs.existsSync(this._absPath(objectKey));
  }

  publicUrl(objectKey) {
    const key = String(objectKey || '').replace(/^\/+/, '').replace(/\\/g, '/');
    return `${this.baseUrl}/${key}`;
  }

  async healthCheck() {
    try {
      fs.mkdirSync(this.root, { recursive: true });
      fs.accessSync(this.root, fs.constants.W_OK);
      return { ok: true, backend: this.backend, detail: { root: this.root } };
    } catch (err) {
      return { ok: false, backend: this.backend, detail: err.message };
    }
  }
}

module.exports = LocalAdapter;
