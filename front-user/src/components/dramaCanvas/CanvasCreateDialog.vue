<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="420px"
    destroy-on-close
    @closed="resetForm"
  >
    <el-form label-position="top" size="default" @submit.prevent="onSubmit">
      <template v-if="type === 'storyboard'">
        <el-form-item label="分镜标题">
          <el-input v-model="form.title" placeholder="留空则自动命名" />
        </el-form-item>
        <el-form-item label="描述（可选）">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="简要描述" />
        </el-form-item>
      </template>

      <template v-else-if="type === 'episode'">
        <el-form-item label="集标题">
          <el-input v-model="form.title" placeholder="留空则自动命名" />
        </el-form-item>
      </template>

      <template v-else-if="type === 'character'">
        <el-form-item label="参考图">
          <div class="ref-image-zone">
            <div class="ref-image-box" @click="refFileInput?.click()" @drop.prevent="onRefImageDrop($event)" @dragover.prevent>
              <img v-if="refImage" :src="refImage.dataUrl" class="ref-preview-img" />
              <div v-else class="ref-upload-hint"><span class="ref-upload-icon">🖼</span><span>点击或拖入参考图</span></div>
            </div>
            <div v-if="refImage" class="ref-actions">
              <el-button size="small" @click="refImage = null">移除</el-button>
            </div>
          </div>
          <input ref="refFileInput" type="file" accept="image/*" class="hidden-file-input" @change="onRefImageFileChange" />
        </el-form-item>
        <el-form-item label="角色名称" required>
          <el-input v-model="form.name" placeholder="必填" />
        </el-form-item>
        <el-form-item label="角色类型">
          <el-select v-model="form.role" placeholder="可选" clearable style="width: 100%">
            <el-option label="主角" value="main" />
            <el-option label="配角" value="supporting" />
          </el-select>
        </el-form-item>
        <el-form-item label="外貌描述">
          <el-input v-model="form.appearance" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </template>

      <template v-else-if="type === 'scene'">
        <el-form-item label="场景地点" required>
          <el-input v-model="form.location" placeholder="必填，如：客厅" />
        </el-form-item>
        <el-form-item label="时间">
          <el-input v-model="form.time" placeholder="如：白天、夜晚" />
        </el-form-item>
        <el-form-item label="场景描述">
          <el-input v-model="form.prompt" type="textarea" :rows="3" />
        </el-form-item>
      </template>

      <template v-else-if="type === 'prop'">
        <el-form-item label="道具名称" required>
          <el-input v-model="form.name" placeholder="必填" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="提示词">
          <el-input v-model="form.prompt" type="textarea" :rows="2" />
        </el-form-item>
      </template>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  type: { type: String, default: 'storyboard' },
  onSubmit: { type: Function, default: null },
})

const emit = defineEmits(['update:modelValue', 'submit'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const submitting = ref(false)
const refFileInput = ref(null)
const refImage = ref(null)
const form = reactive({
  title: '',
  description: '',
  name: '',
  role: '',
  appearance: '',
  location: '',
  time: '',
  prompt: '',
})

function getFirstImageFile(dataTransfer) {
  if (!dataTransfer?.files?.length) return null
  const file = Array.from(dataTransfer.files).find((f) => f.type.startsWith('image/'))
  return file || null
}

function readFileAsRefImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (ev) => resolve({ dataUrl: ev.target.result, filename: file.name })
    reader.readAsDataURL(file)
  })
}

async function onRefImageFileChange(event) {
  const file = event.target?.files?.[0]
  if (!file) return
  const result = await readFileAsRefImage(file)
  refImage.value = result
  event.target.value = ''
}

async function onRefImageDrop(event) {
  const file = getFirstImageFile(event.dataTransfer)
  if (!file) return
  const result = await readFileAsRefImage(file)
  refImage.value = result
}

const dialogTitle = computed(() => {
  const map = {
    storyboard: '新建分镜',
    episode: '新建集',
    character: '新建角色',
    scene: '新建场景',
    prop: '新建道具',
  }
  return map[props.type] || '新建'
})

function resetForm() {
  form.title = ''
  form.description = ''
  form.name = ''
  form.role = ''
  form.appearance = ''
  form.location = ''
  form.time = ''
  form.prompt = ''
  refImage.value = null
  submitting.value = false
}

watch(() => props.type, () => resetForm())

function validate() {
  if (props.type === 'character' || props.type === 'prop') {
    if (!form.name.trim()) {
      ElMessage.warning('请填写名称')
      return false
    }
  }
  if (props.type === 'scene' && !form.location.trim()) {
    ElMessage.warning('请填写场景地点')
    return false
  }
  return true
}

async function onSubmit() {
  if (!validate()) return
  submitting.value = true
  try {
    const handler = props.onSubmit || ((form) => emit('submit', form))
    await handler({ ...form, refImage: refImage.value })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.hidden-file-input {
  display: none;
}

.ref-image-zone {
  width: 100%;
}

.ref-image-box {
  width: 100%;
  height: 140px;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s;
}

.ref-image-box:hover {
  border-color: #6366f1;
}

.ref-preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.ref-upload-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #909399;
}

.ref-upload-icon {
  font-size: 28px;
}

.ref-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  justify-content: flex-end;
}
</style>
