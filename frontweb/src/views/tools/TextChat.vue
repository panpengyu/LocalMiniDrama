<template>
  <div class="tool-page">
    <div class="tool-header">
      <h2 class="tool-title">文字对话</h2>
      <p class="tool-desc">与AI助手进行文字交流</p>
    </div>
    <div class="tool-content">
      <el-card class="tool-card chat-card">
        <div class="chat-container">
          <div class="chat-messages">
            <div v-for="(msg, idx) in messages" :key="idx" :class="['chat-message', msg.role]">
              <div class="avatar">{{ msg.role === 'user' ? '👤' : '🤖' }}</div>
              <div class="content">{{ msg.content }}</div>
            </div>
          </div>
          <div class="chat-input-area">
            <el-input v-model="inputMessage" placeholder="输入消息..." @keyup.enter="send" />
            <el-button type="primary" @click="send">发送</el-button>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const messages = ref([
  { role: 'assistant', content: '你好！我是你的AI助手，有什么可以帮你的？' }
])
const inputMessage = ref('')

function send() {
  if (!inputMessage.value.trim()) return
  
  messages.value.push({ role: 'user', content: inputMessage.value })
  inputMessage.value = ''
  
  setTimeout(() => {
    messages.value.push({ role: 'assistant', content: '收到！我正在处理你的请求...' })
  }, 500)
}
</script>

<style scoped>
.tool-page {
  padding: 24px;
}

.tool-header {
  margin-bottom: 24px;
}

.tool-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px;
  color: #303133;
}

.tool-desc {
  font-size: 14px;
  color: #909399;
  margin: 0;
}

.tool-content {
  max-width: 800px;
}

.chat-card {
  border-radius: 12px;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 400px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.chat-message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.chat-message.user {
  flex-direction: row-reverse;
}

.chat-message.user .content {
  background: #667eea;
  color: #fff;
  border-radius: 16px 4px 16px 16px;
}

.chat-message.assistant .content {
  background: #f0f2f5;
  border-radius: 4px 16px 16px 16px;
}

.avatar {
  font-size: 24px;
  flex-shrink: 0;
}

.content {
  max-width: 70%;
  padding: 12px 16px;
  font-size: 14px;
  line-height: 1.6;
}

.chat-input-area {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid #f0f0f0;
}

.chat-input-area :deep(.el-input) {
  flex: 1;
}
</style>