<template>
  <div class="page-placeholder">
    <el-card>
      <template #header>
        <span>{{ pageTitle }}</span>
      </template>
      <el-empty description="功能开发中，敬请期待" />
    </el-card>
  </div>
</template>

<script setup>
const pageTitle = '用户问题排查'
</script>

<style scoped>
.page-placeholder {
  padding: 20px;
}
</style>
