'use strict';

/**
 * Sprint 12 - S12-T03 MinIO / S3 兼容对象存储适配器
 *
 * 基于 S3 协议实现，兼容 MinIO / 阿里云 OSS(S3兼容模式) / 腾讯云 COS(S3兼容模式)。
 * SDK 采用「惰性 require」：仅在实际选用该后端时才加载 @aws-sdk/client-s3，
 * 未安装依赖则抛出清晰的安装提示，避免强制所有部署环境安装对象存储 SDK。
 *
 * 依赖安装（选用 minio/oss/cos 后端时）：
 *   npm i @aws-sdk/client-s3
 */
const StorageAdapter = require('./StorageAdapter');

function lazyLoadS3() {
  try {
    // eslint-disable-next-line global-require
    return require('@aws-sdk/client-s3');
  } catch (err) {
    throw new Error(
      '选用对象存储后端(minio/oss/cos)需要安装 S3 客户端：请执行 `npm i @aws-sdk/client-s3`。原始错误：' + err.message
    );
  }
}

async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream.transformToByteArray === 'function') {
    return Buffer.from(await stream.transformToByteArray());
  }
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

class MinIOAdapter extends StorageAdapter {
  /**
   * @param {object} opts { backend, endpoint, region, bucket, accessKey, secretKey, publicBaseUrl, forcePathStyle }
   */
  constructor(opts = {}) {
    super();
    this._backend = opts.backend || 'minio';
    this.bucket = opts.bucket;
    this.publicBaseUrl = (opts.publicBaseUrl || '').replace(/\/$/, '');
    if (!this.bucket) throw new Error('对象存储缺少 bucket 配置');

    const s3 = lazyLoadS3();
    this._s3mod = s3;
    this.client = new s3.S3Client({
      endpoint: opts.endpoint,
      region: opts.region || 'us-east-1',
      credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
      forcePathStyle: opts.forcePathStyle !== false, // MinIO 默认 path-style
    });
  }

  get backend() {
    return this._backend;
  }

  _key(objectKey) {
    return String(objectKey || '').replace(/^\/+/, '').replace(/\\/g, '/');
  }

  async putObject(objectKey, buffer, opts = {}) {
    const key = this._key(objectKey);
    const { PutObjectCommand } = this._s3mod;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: opts.contentType || 'application/octet-stream',
    }));
    return { objectKey: key, url: this.publicUrl(key), size: buffer.length, backend: this.backend };
  }

  async getObject(objectKey) {
    const { GetObjectCommand } = this._s3mod;
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this._key(objectKey) }));
    return streamToBuffer(res.Body);
  }

  async deleteObject(objectKey) {
    const { DeleteObjectCommand } = this._s3mod;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this._key(objectKey) }));
    return true;
  }

  async exists(objectKey) {
    const { HeadObjectCommand } = this._s3mod;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this._key(objectKey) }));
      return true;
    } catch (_) {
      return false;
    }
  }

  publicUrl(objectKey) {
    const key = this._key(objectKey);
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${key}`;
    return `/${this.bucket}/${key}`;
  }

  async healthCheck() {
    try {
      const { HeadBucketCommand } = this._s3mod;
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, backend: this.backend, detail: { bucket: this.bucket } };
    } catch (err) {
      return { ok: false, backend: this.backend, detail: err.message };
    }
  }
}

module.exports = MinIOAdapter;
