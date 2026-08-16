<template>
  <div class="finance-page">
    <el-card class="top-card" shadow="never">
      <div class="top-toolbar">
        <div class="toolbar-title">
          <el-icon :size="22" color="#409eff"><Coin /></el-icon>
          <span>支付配置</span>
          <span class="subtitle">微信支付 v3 / 支付宝商户凭据；密钥 AES-256-GCM 加密落库，界面仅展示脱敏掩码</span>
        </div>
        <div class="actions">
          <el-button :loading="loading" @click="load">刷新</el-button>
          <el-button type="warning" :loading="testing" @click="runTest">测试支付</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
        </div>
      </div>
    </el-card>

    <el-alert
      v-if="selfCheckResult"
      :type="selfCheckResult.ok ? 'success' : 'error'"
      :title="selfCheckResult.ok ? '测试支付通过' : '测试支付未通过'"
      :description="selfCheckResult.message"
      show-icon
      :closable="true"
      class="selfcheck-alert"
    >
      <template v-if="selfCheckResult.detail" #default>
        <div class="selfcheck-detail">
          <template v-if="selfCheckResult.detail.wechat">
            微信｜商户号：{{ selfCheckResult.detail.wechat.mchid || '—' }}｜证书：{{ selfCheckResult.detail.wechat.certs || 0 }} 张
            ｜APIv3：{{ selfCheckResult.detail.wechat.aesOk ? '可用' : '不可用' }}｜验签：{{ selfCheckResult.detail.wechat.rsaOk ? '可用' : '不可用' }}
          </template>
          <template v-if="selfCheckResult.detail.alipay">
            <br v-if="selfCheckResult.detail.wechat" />
            支付宝｜AppID：{{ selfCheckResult.detail.alipay.app_id || '—' }}｜环境：{{ selfCheckResult.detail.alipay.sandbox ? '沙箱' : '正式' }}
            ｜RSA2 签名自检：{{ selfCheckResult.detail.alipay.sign_verified ? '通过' : '未通过' }}
          </template>
        </div>
      </template>
    </el-alert>

    <el-card shadow="never" v-loading="loading" class="channel-card">
      <template #header>
        <div class="card-header">
          <el-tag :type="wechat.configured ? 'success' : 'info'" effect="dark" size="small">
            {{ wechat.configured ? '已开通' : '未开通' }}
          </el-tag>
          <span class="card-title">微信支付（APIv3）</span>
        </div>
      </template>
      <el-form label-width="150px" class="channel-form">
        <el-form-item label="商户号 MchID">
          <el-input v-model="wechat.mchid" placeholder="微信支付商户号，如 1900000109" />
        </el-form-item>
        <el-form-item label="AppID">
          <el-input v-model="wechat.app_id" placeholder="公众号/小程序/APP 的 AppID（下单用）" />
        </el-form-item>
        <el-form-item label="回调地址 NotifyURL">
          <el-input v-model="wechat.notify_url" placeholder="https://your-domain.com/api/membership/pay/notify/wechat" />
        </el-form-item>
        <el-form-item label="APIv3 密钥">
          <el-input v-model="wechat.api_v3_key" type="password" show-password
            :placeholder="wechat.api_v3_key_mask ? `已保存（${wechat.api_v3_key_mask}），留空则不修改` : '32 位密钥，仅填一次'" />
          <div class="form-tip">用于回调解密，长度必须为 32 字节；留空表示沿用已保存值</div>
        </el-form-item>
        <el-form-item label="平台证书">
          <div class="certs-block">
            <div v-for="(c, idx) in wechat.certs" :key="idx" class="cert-row">
              <el-input v-model="c.serial_no" placeholder="证书序列号 SerialNo" style="width: 320px" />
              <el-input v-model="c.public_key_pem" type="textarea" :rows="3" placeholder="-----BEGIN PUBLIC KEY-----\n… 平台证书公钥 PEM …" />
              <el-button type="danger" plain size="small" @click="wechat.certs.splice(idx, 1)">移除</el-button>
            </div>
            <el-button size="small" @click="wechat.certs.push({ serial_no: '', public_key_pem: '' })">+ 添加证书</el-button>
            <div class="form-tip">
              已保存 {{ wechat.platform_certs_count || 0 }} 张证书。如需更新请粘贴完整「序列号 + 公钥 PEM」；
              不添加则不修改现有证书。
            </div>
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" v-loading="loading" class="channel-card">
      <template #header>
        <div class="card-header">
          <el-tag :type="alipay.configured ? 'success' : 'info'" effect="dark" size="small">
            {{ alipay.configured ? '已开通' : '未开通' }}
          </el-tag>
          <span class="card-title">支付宝（电脑网站支付 / 当面付）</span>
        </div>
      </template>
      <el-form label-width="150px" class="channel-form">
        <el-form-item label="商户号 PID">
          <el-input v-model="alipay.merchant_id" placeholder="支付宝商户号，如 2088xxxxxxxx" />
        </el-form-item>
        <el-form-item label="AppID">
          <el-input v-model="alipay.app_id" placeholder="开放平台应用 AppID" />
        </el-form-item>
        <el-form-item label="回调地址 NotifyURL">
          <el-input v-model="alipay.notify_url" placeholder="https://your-domain.com/api/membership/pay/notify/alipay" />
        </el-form-item>
        <el-form-item label="应用私钥">
          <el-input v-model="alipay.api_key" type="password" show-password
            :placeholder="alipay.api_key_mask ? `已保存（${alipay.api_key_mask}），留空则不修改` : 'RSA2 应用私钥（PKCS8 PEM）'" />
          <div class="form-tip">RSA2 应用私钥，用于生成请求签名；留空表示沿用已保存值</div>
        </el-form-item>
        <el-form-item label="支付宝公钥">
          <el-input v-model="alipay.alipay_public_key" type="textarea" :rows="3"
            placeholder="-----BEGIN PUBLIC KEY-----\n… 支付宝平台公钥 PEM …（留空不修改）" />
        </el-form-item>
        <el-form-item label="支付环境">
          <el-switch v-model="alipay.sandbox" active-text="沙箱（开放平台沙箱环境）" inactive-text="正式环境" />
          <div class="form-tip">开启后统一下单/回调网关指向 openapi.alipaydev.com（沙箱），测试完成后请务必关闭</div>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Coin } from '@element-plus/icons-vue'
import financeAPI from '@/api/finance'

const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const selfCheckResult = ref(null)

const wechat = reactive({
  configured: false, mchid: '', app_id: '', notify_url: '', api_v3_key: '',
  api_v3_key_mask: '', platform_certs_count: 0, certs: [],
})
const alipay = reactive({
  configured: false, merchant_id: '', app_id: '', notify_url: '', api_key: '',
  api_key_mask: '', alipay_public_key: '', sandbox: false,
})

async function load() {
  loading.value = true
  try {
    const res = await financeAPI.getPaymentSettings()
    Object.assign(wechat, {
      configured: !!(res && res.wechat && res.wechat.configured),
      mchid: (res && res.wechat && res.wechat.mchid) || '',
      app_id: (res && res.wechat && res.wechat.app_id) || '',
      notify_url: (res && res.wechat && res.wechat.notify_url) || '',
      api_v3_key: '',
      api_v3_key_mask: (res && res.wechat && res.wechat.api_v3_key_mask) || '',
      platform_certs_count: (res && res.wechat && res.wechat.platform_certs_count) || 0,
    })
    Object.assign(alipay, {
      configured: !!(res && res.alipay && res.alipay.configured),
      merchant_id: (res && res.alipay && res.alipay.merchant_id) || '',
      app_id: (res && res.alipay && res.alipay.app_id) || '',
      notify_url: (res && res.alipay && res.alipay.notify_url) || '',
      api_key: '',
      api_key_mask: (res && res.alipay && res.alipay.api_key_mask) || '',
      alipay_public_key: '',
      sandbox: !!(res && res.alipay && res.alipay.sandbox),
    })
    // 证书编辑行默认保留空模板（更新需整表重填）
    wechat.certs = []
  } catch (e) {
    ElMessage.error(e?.message || '加载支付配置失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const payload = {
      wechat: {
        mchid: wechat.mchid.trim(),
        app_id: wechat.app_id.trim(),
        notify_url: wechat.notify_url.trim(),
      },
      alipay: {
        merchant_id: alipay.merchant_id.trim(),
        app_id: alipay.app_id.trim(),
        notify_url: alipay.notify_url.trim(),
        sandbox: alipay.sandbox,
      },
    }
    if (wechat.api_v3_key) {
      if (wechat.api_v3_key.length !== 32) {
        ElMessage.warning('微信 APIv3 密钥必须为 32 字节')
        return
      }
      payload.wechat.api_v3_key = wechat.api_v3_key
    }
    const filledCerts = wechat.certs.filter(c => c.serial_no.trim() && c.public_key_pem.trim())
    if (filledCerts.length) {
      payload.wechat.platform_certs = filledCerts.map(c => ({
        serial_no: c.serial_no.trim(), public_key_pem: c.public_key_pem,
      }))
    }
    if (alipay.api_key) payload.alipay.api_key = alipay.api_key
    if (alipay.alipay_public_key.trim()) payload.alipay.alipay_public_key = alipay.alipay_public_key

    await financeAPI.updatePaymentSettings(payload)
    ElMessage.success('支付配置已保存（密钥已加密存储）')
    selfCheckResult.value = null
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function runTest() {
  testing.value = true
  selfCheckResult.value = null
  try {
    const res = await financeAPI.testPayment()
    selfCheckResult.value = { ok: true, message: res.message, detail: res.detail }
  } catch (e) {
    selfCheckResult.value = {
      ok: false,
      message: (e && e.message) || '测试失败',
      detail: (e && e.details) || null,
    }
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.finance-page {
  padding: 16px;
}
.top-card {
  margin-bottom: 16px;
}
.top-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
}
.toolbar-title .subtitle {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
}
.actions {
  display: flex;
  gap: 8px;
}
.selfcheck-alert {
  margin-bottom: 16px;
}
.selfcheck-detail {
  margin-top: 6px;
  font-size: 12px;
  color: #606266;
}
.channel-card {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
}
.certs-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cert-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.cert-row .el-textarea {
  flex: 1;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
</style>
