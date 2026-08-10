<template>
  <!-- ============================================================
       S3-T03/T04/T05: 一站式创作工作台 DramaWorkbench
       四区域布局：
         [上 ] 顶部工具栏（面包屑/集数筛选/快捷操作/切换列表模式）
         [中左] ProjectNavTree (项目7分类导航树)
         [中中] WorkbenchCanvas (画布核心)
         [中右] WorkbenchAIPanel (4Tab AI助手 + 生成队列)
         [下 ] StoryboardTimeline (底部时间轴缩略图+拖拽排序)
       ============================================================ -->
  <div class="workbench-shell" :class="{ 'is-dark': isDark }">
    <!-- ============ 顶部工具栏 ============ -->
    <header class="wb-header">
      <div class="wb-h-left">
        <h1 class="wb-logo" @click="router.push('/dashboard')">
          <span class="wb-logo-main">🎬 本地短剧助手</span>
          <span class="wb-logo-sub">一站式工作台</span>
        </h1>
        <span class="wb-breadcrumb-sep">›</span>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item :to="{ path: '/dashboard' }">项目列表</el-breadcrumb-item>
          <el-breadcrumb-item>{{ drama?.title || '加载中…' }}</el-breadcrumb-item>
        </el-breadcrumb>
      </div>
      <div class="wb-h-center">
        <el-select
          v-model="filterEpisodeId"
          size="small"
          style="width: 160px"
          @change="onFilterEpisodeChange"
        >
          <el-option key="all" label="全部集数" value="all" />
          <el-option
            v-for="ep in (drama?.episodes || [])"
            :key="ep.id"
            :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
            :value="ep.id"
          />
        </el-select>
        <el-tag size="small" effect="plain" v-if="layoutState === 'saving'" type="warning">布局保存中…</el-tag>
        <el-tag size="small" effect="plain" v-else-if="layoutState === 'saved'" type="success">布局已保存</el-tag>
      </div>
      <div class="wb-h-right">
        <el-button size="small" type="warning" plain @click="focusScriptNode">
          📜 定位剧本
        </el-button>
        <el-button size="small" @click="openCreateDrawer('character')">
          <el-icon><Plus /></el-icon>
          角色
        </el-button>
        <el-button size="small" @click="openCreateDrawer('scene')">场景</el-button>
        <el-button size="small" @click="openCreateDrawer('storyboard')">分镜</el-button>
        <!-- S7: 智能工作流 + 智能剪辑入口 -->
        <el-button size="small" type="primary" plain @click="wfOrchVisible = true">
          <el-icon><Connection /></el-icon>
          工作流
        </el-button>
        <el-button size="small" type="success" plain @click="openWorkflowMonitor">
          <el-icon><Monitor /></el-icon>
          执行监控
        </el-button>
        <el-button size="small" type="warning" plain @click="openSmartEdit">
          <el-icon><VideoCamera /></el-icon>
          智能剪辑
        </el-button>
        <el-button size="small" @click="toggleTheme" class="wb-theme-btn">
          <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
          {{ isDark ? '浅色' : '暗色' }}
        </el-button>
        <el-button type="primary" plain size="small" @click="goListMode">
          <el-icon><List /></el-icon>
          列表模式
        </el-button>
        <el-button type="primary" size="small" @click="goCanvasMode">
          <el-icon><FullScreen /></el-icon>
          独立画布
        </el-button>
      </div>
    </header>

    <!-- ============ 主体三栏 + 底部时间轴 ============ -->
    <div class="wb-body">
      <!-- 中：三栏 -->
      <div class="wb-center-row" :style="{ height: centerRowHeight }">
        <!-- 左栏：ProjectNavTree (S3-T04) -->
        <aside class="wb-col-left" :style="{ width: leftColWidth }">
          <ProjectNavTree
            :project-title="drama?.title"
            :script="drama?.script"
            :characters="drama?.characters || []"
            :scenes="drama?.scenes || []"
            :props-list="drama?.props || []"
            :storyboards="storyboards"
            :audios="audios"
            :episodes="drama?.episodes || []"
            :selected-key="treeSelectedKey"
            @select="onTreeSelect"
            @quick-add="onTreeQuickAdd"
            @go-screenwriter="router.push('/screenwriter')"
            @go-canvas="goCanvasMode"
          />
          <!-- 拖动分隔条 -->
          <div class="wb-resizer wb-resizer-right" @mousedown="(e)=>startResize(e, 'left')"></div>
        </aside>

        <!-- 中栏：WorkbenchCanvas (S3-T05) -->
        <section class="wb-col-center">
          <WorkbenchCanvas
            ref="wbCanvasRef"
            :drama-id="dramaId"
            :highlight-asset-id="highlightAssetId"
            :focus-storyboard-id="timelineFocusSbId"
            :filter-episode-id="filterEpisodeId"
            @drama-loaded="onDramaLoaded"
            @node-click="onCanvasNodeClick"
            @storyboard-click="onCanvasStoryboardClick"
            @script-click="onCanvasScriptClick"
            @layout-saved="onCanvasLayoutSaved"
            @selection-change="onCanvasSelectionChange"
          />
        </section>

        <!-- 右栏：WorkbenchAIPanel (S3-T06) -->
        <aside class="wb-col-right" :style="{ width: rightColWidth }">
          <WorkbenchAIPanel
            :collapsed="aiPanelCollapsed"
            :drama-id="dramaId"
            :character-list="drama?.characters || []"
            @collapse="aiPanelCollapsed = !aiPanelCollapsed"
            @generated="onAIGenerated"
            @queue-update="onAIQueueUpdate"
          />
          <div v-if="!aiPanelCollapsed"
            class="wb-resizer wb-resizer-left"
            @mousedown="(e)=>startResize(e, 'right')"
          ></div>
        </aside>
      </div>

      <!-- 下：StoryboardTimeline (S3-T07) -->
      <div class="wb-timeline-row" :style="{ height: timelineHeight }">
        <div class="wb-timeline-resizer" @mousedown="(e)=>startResize(e, 'bottom')"></div>
        <StoryboardTimeline
          :frames="framesForTimeline"
          :episodes="drama?.episodes || []"
          :focus-id="canvasFocusSbId"
          :episode-filter-value="filterEpisodeId === 'all' ? null : filterEpisodeId"
          :dubbing-map="dubbingMap"
          @update:frames="onTimelineFramesUpdate"
          @select="onTimelineSelect"
          @reorder="onTimelineReorder"
          @playReel="onTimelinePlay"
          @align-duration="onTimelineAlignDuration"
          @update:episodeFilter="(v)=>{ filterEpisodeId = v || 'all'; onFilterEpisodeChange() }"
        />
      </div>
    </div>

    <!-- ============== 右侧 Drawer：角色一致性面板 (S3-T01) ============== -->
    <el-drawer
      v-model="charDrawerVisible"
      :title="selectedCharacter ? selectedCharacter.name + ' - 角色详情与一致性' : '角色详情'"
      direction="rtl"
      size="460px"
      :with-header="true"
    >
      <CharacterConsistencyPanel
        :character="selectedCharacter"
        :drama-id="dramaId"
        @updated="onConsistencyPanelUpdated"
        @regenerate="onCharRegenerateReference"
      />
      <template #footer>
        <div style="display:flex; justify-content:space-between; width:100%">
          <el-button size="small" @click="charDrawerVisible = false">关闭</el-button>
          <div>
            <el-button size="small" @click="openCharacterEdit">编辑角色资料</el-button>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- ============== 通用创建 Drawer (快速新建角色/场景/分镜) ============== -->
    <el-drawer
      v-model="createDrawerVisible"
      :title="createDrawerTitle"
      direction="ltr"
      size="420px"
    >
      <div v-if="createDrawerType === 'character'" class="wb-create-body">
        <el-form :model="charForm" label-width="80px" label-position="left">
          <el-form-item label="角色名"><el-input v-model="charForm.name" /></el-form-item>
          <el-form-item label="类型">
            <el-select v-model="charForm.role" style="width:100%">
              <el-option label="主角" value="protagonist" />
              <el-option label="反派" value="antagonist" />
              <el-option label="配角" value="supporting" />
              <el-option label="客串" value="cameo" />
              <el-option label="旁白" value="narrator" />
            </el-select>
          </el-form-item>
          <el-form-item label="外貌描述">
            <el-input v-model="charForm.position" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="性格特征">
            <el-input v-model="charForm.personality" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="身份/背景">
            <el-input v-model="charForm.background" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>
        <div class="wb-create-foot">
          <el-button @click="createDrawerVisible = false">取消</el-button>
          <el-button type="primary" @click="onSubmitCreateCharacter">保存到数据库</el-button>
        </div>
      </div>

      <div v-else-if="createDrawerType === 'scene'" class="wb-create-body">
        <el-form :model="sceneForm" label-width="80px">
          <el-form-item label="场景地点"><el-input v-model="sceneForm.location" /></el-form-item>
          <el-form-item label="时间段">
            <el-select v-model="sceneForm.time" style="width:100%">
              <el-option label="白天" value="day" />
              <el-option label="夜晚" value="night" />
              <el-option label="黎明" value="dawn" />
              <el-option label="黄昏" value="dusk" />
            </el-select>
          </el-form-item>
          <el-form-item label="氛围描述">
            <el-input v-model="sceneForm.atmosphere" type="textarea" :rows="3" />
          </el-form-item>
        </el-form>
        <div class="wb-create-foot">
          <el-button @click="createDrawerVisible = false">取消</el-button>
          <el-button type="primary" @click="onSubmitCreateScene">保存到数据库</el-button>
        </div>
      </div>

      <div v-else-if="createDrawerType === 'storyboard'" class="wb-create-body">
        <el-form :model="sbForm" label-width="80px">
          <el-form-item label="所属集">
            <el-select v-model="sbForm.episode_id" style="width:100%">
              <el-option
                v-for="ep in (drama?.episodes || [])"
                :key="ep.id"
                :label="ep.title || '第' + (ep.episode_number || 0) + '集'"
                :value="ep.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="动作描述"><el-input v-model="sbForm.action" type="textarea" :rows="3" /></el-form-item>
          <el-form-item label="对白">
            <el-input v-model="sbForm.dialogue" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="镜头类型">
            <el-select v-model="sbForm.shot_type" style="width:100%">
              <el-option label="远景 (LS)" value="LS" />
              <el-option label="全景 (FS)" value="FS" />
              <el-option label="中景 (MS)" value="MS" />
              <el-option label="近景 (CU)" value="CU" />
              <el-option label="特写 (ECU)" value="ECU" />
              <el-option label="过肩 (OTS)" value="OTS" />
            </el-select>
          </el-form-item>
          <el-form-item label="镜头角度">
            <el-select v-model="sbForm.angle_s" style="width:100%">
              <el-option label="平视" value="eye_level" />
              <el-option label="俯视" value="high_angle" />
              <el-option label="仰视" value="low_angle" />
              <el-option label="鸟瞰" value="bird_eye" />
            </el-select>
          </el-form-item>
        </el-form>
        <div class="wb-create-foot">
          <el-button @click="createDrawerVisible = false">取消</el-button>
          <el-button type="primary" @click="onSubmitCreateStoryboard">保存到数据库</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- ============== 内嵌剧集资料 Drawer（S3-T05 验收点：替代 goListMode，消除页面跳转 /drama/:id） ============== -->
    <el-drawer
      v-model="infoDrawerVisible"
      title="剧集资料 · 一站式内嵌管理（无需跳转）"
      direction="ltr"
      size="560px"
      :with-header="true"
    >
      <el-tabs v-model="infoDrawerTab">
        <!-- ① 剧集基本信息 Tab，内嵌管理 → 替代 DramaDetail 剧集信息 section -->
        <el-tab-pane label="剧集信息" name="info">
          <div class="info-section">
            <div class="info-section-title">基本信息（可直接编辑并保存）</div>
            <el-form label-width="100px" label-position="left">
              <el-form-item label="标题">
                <el-input v-model="infoDrawerForm.title" placeholder="剧集标题" />
              </el-form-item>
              <el-form-item label="风格">
                <el-select v-model="infoDrawerForm.style" clearable style="width:100%">
                  <el-option-group label="写实 / 影视">
                    <el-option label="写实" value="realistic" /><el-option label="电影感" value="cinematic" />
                    <el-option label="纪录片" value="documentary" /><el-option label="黑色电影" value="noir" />
                  </el-option-group>
                  <el-option-group label="动漫 / 卡通">
                    <el-option label="日本动漫" value="anime style" /><el-option label="欧美漫画" value="comic style" />
                  </el-option-group>
                  <el-option-group label="中国风">
                    <el-option label="中国风" value="chinese style" /><el-option label="古装" value="historical" /><el-option label="武侠" value="wuxia" />
                  </el-option-group>
                </el-select>
              </el-form-item>
              <el-form-item label="画面比例">
                <el-select v-model="infoDrawerForm.aspect_ratio" style="width:100%">
                  <el-option label="16:9 横屏" value="16:9" />
                  <el-option label="9:16 竖屏短剧" value="9:16" />
                  <el-option label="1:1 方形" value="1:1" />
                  <el-option label="4:3" value="4:3" />
                  <el-option label="21:9" value="21:9" />
                </el-select>
              </el-form-item>
              <el-form-item label="故事梗概">
                <el-input v-model="infoDrawerForm.description" type="textarea" :rows="4" />
              </el-form-item>
            </el-form>
            <div class="info-foot">
              <el-button :loading="infoDrawerSaving" type="primary" @click="saveInfoDrawer">保存到数据库</el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- ② 分集列表 Tab → 内嵌 DramaDetail 分集列表核心功能 -->
        <el-tab-pane label="分集列表" name="episodes">
          <div class="info-section">
            <div class="info-section-title-row">
              <div class="info-section-title">共 {{ (drama?.episodes || []).length }} 集</div>
              <el-button size="small" type="primary" @click="addEpisodeInline">
                <el-icon><Plus /></el-icon>新增一集
              </el-button>
            </div>
            <div v-if="!drama?.episodes?.length" class="wb-empty-hint">本剧暂无分集，点击右上角新增一集</div>
            <div v-else class="ep-list">
              <div v-for="(ep, i) in (drama.episodes || [])" :key="ep.id" class="ep-card">
                <div class="ep-head">
                  <div class="ep-number">第 {{ ep.episode_number ?? i + 1 }} 集</div>
                  <el-tag size="small" :type="{ draft: 'info', processing: 'warning', completed: 'success', failed: 'danger' }[ep.status] || 'info'">
                    {{ { draft: '草稿', processing: '生成中', completed: '已完成', failed: '失败' }[ep.status] || ep.status || '草稿' }}
                  </el-tag>
                  <span class="ep-actions">
                    <el-button size="small" link type="primary" @click="editEpisodeInline(ep)">编辑</el-button>
                    <el-button size="small" link type="danger" @click="deleteEpisodeInline(ep)">删除</el-button>
                  </span>
                </div>
                <div class="ep-title">{{ ep.title || `第 ${ep.episode_number ?? i + 1} 集（未命名）` }}</div>
                <div class="ep-desc">{{ (ep.description || '').slice(0, 80) || '无剧情描述' }}{{ (ep.description || '').length > 80 ? '…' : '' }}</div>
                <div class="ep-meta">分镜数：{{ (ep.storyboards || []).length || 0 }} 张</div>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- ③ 剧本大纲 Tab → 在工作台内直接管理剧本，无需跳转 -->
        <el-tab-pane label="剧本大纲" name="script">
          <div class="info-section">
            <div class="info-section-title-row">
              <div class="info-section-title">剧本结构（大纲/三幕式）</div>
              <el-button size="small" type="primary" :loading="saveOutlineLoading" @click="saveOutlineInline">保存剧本结构</el-button>
            </div>
            <el-form label-width="100px" label-position="left">
              <el-form-item label="三幕·开端"><el-input v-model="infoDrawerScript.act1" type="textarea" :rows="4" placeholder="第一幕：建置/钩子/人物出场" /></el-form-item>
              <el-form-item label="三幕·对抗"><el-input v-model="infoDrawerScript.act2" type="textarea" :rows="6" placeholder="第二幕：升级冲突/中点转折/困境" /></el-form-item>
              <el-form-item label="三幕·结局"><el-input v-model="infoDrawerScript.act3" type="textarea" :rows="4" placeholder="第三幕：高潮/解决/余韵" /></el-form-item>
              <el-form-item label="故事风格关键字"><el-input v-model="infoDrawerScript.tags" placeholder="例如：复仇,暗黑,反转,小人物逆袭" /></el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-drawer>

    <!-- ============== 内嵌剧本节点 Drawer（画布点击"剧本节点"打开） ============== -->
    <el-drawer v-model="scriptDrawerVisible" title="剧本节点 · 结构管理" direction="rtl" size="520px">
      <div class="info-section">
        <div class="info-section-title-row">
          <div class="info-section-title">一句话创意 → 三幕结构</div>
        </div>
        <el-form label-width="100px" label-position="left">
          <el-form-item label="一句话创意"><el-input v-model="scriptDrawerForm.idea" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="创作模板">
            <el-select v-model="scriptDrawerForm.template" style="width:100%">
              <el-option label="三幕式" value="three_act" /><el-option label="起承转合" value="kikaku" />
              <el-option label="英雄之旅" value="hero_journey" /><el-option label="救猫咪" value="save_the_cat" />
            </el-select>
          </el-form-item>
          <el-form-item label="第一幕"><el-input v-model="scriptDrawerForm.act1" type="textarea" :rows="3" /></el-form-item>
          <el-form-item label="第二幕"><el-input v-model="scriptDrawerForm.act2" type="textarea" :rows="5" /></el-form-item>
          <el-form-item label="第三幕"><el-input v-model="scriptDrawerForm.act3" type="textarea" :rows="3" /></el-form-item>
        </el-form>
        <div class="info-foot">
          <el-button :loading="saveOutlineLoading" type="primary" @click="saveOutlineInline">保存剧本结构</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- ============== 内嵌分镜节点 Drawer（画布点击分镜节点 / S3-T05：在工作台内编辑分镜，无需跳转） ============== -->
    <el-drawer v-model="sbDrawerVisible" :title="editingSb ? `分镜 #${editingSb.storyboard_number || ''} 编辑` : '分镜编辑'" direction="rtl" size="560px">
      <div v-if="editingSb" class="info-section">
        <div class="info-section-title-row">
          <div class="info-section-title">分镜核心信息（直接写入 MySQL）</div>
          <el-tag size="small" type="info">ID：{{ editingSb.id }}</el-tag>
          <el-button size="small" link type="danger" @click="deleteSbInline" style="margin-left:auto">删除此分镜</el-button>
        </div>
        <!-- 一致性 & 重试摘要（S3-T01/T02 联动） -->
        <div v-if="editingSb.consistency_score != null || editingSb.retry_count > 0" class="sb-consistency-row" :class="{ fail: Number(editingSb.consistency_score) < 0.85 }">
          <el-tag :type="Number(editingSb.consistency_score) < 0.85 ? 'danger' : 'success'" effect="dark" size="small">
            一致性 {{ (Number(editingSb.consistency_score) * 100).toFixed(0) }}%
          </el-tag>
          <el-tag v-if="editingSb.retry_count > 0" type="warning" size="small">自动重试 R{{ editingSb.retry_count }} / 3</el-tag>
          <span v-if="Number(editingSb.consistency_score) < 0.85" class="warn-sub">低于阈值，点击"重绘"可追加强化 prompt 自动重试</span>
          <el-button v-if="Number(editingSb.consistency_score) < 0.85" size="small" type="warning" style="margin-left:auto" @click="redrawLowSb">一致性强制重绘</el-button>
        </div>

        <el-form label-width="90px" label-position="left">
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="所属集">
                <el-select v-model="editingSb.episode_id" style="width:100%">
                  <el-option v-for="ep in (drama?.episodes || [])" :key="ep.id"
                    :label="ep.title || '第' + (ep.episode_number || '') + '集'" :value="ep.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="序号"><el-input-number v-model="editingSb.storyboard_number" :min="1" :max="999" controls-position="right" style="width:100%" /></el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="镜头类型">
                <el-select v-model="editingSb.shot_type" style="width:100%">
                  <el-option v-for="v in ['LS','FS','MS','CU','ECU','OTS']" :key="v" :label="v" :value="v" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="镜头角度">
                <el-select v-model="editingSb.angle_s" style="width:100%">
                  <el-option v-for="v in ['eye_level','high_angle','low_angle','bird_eye','dutch_angle']" :key="v" :label="v" :value="v" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="动作描述"><el-input v-model="editingSb.action" type="textarea" :rows="4" /></el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="对白/旁白"><el-input v-model="editingSb.dialogue" type="textarea" :rows="3" /></el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="关联角色"><el-select v-model="editingSb._chars" multiple filterable placeholder="选择本分镜出演角色（用于一致性校验关联）" style="width:100%">
                <el-option v-for="c in (drama?.characters || [])" :key="c.id" :label="c.name" :value="c.id" />
              </el-select></el-form-item>
            </el-col>
            <el-col :span="24">
              <el-form-item label="画面/Prompt备注"><el-input v-model="editingSb.prompt_note" type="textarea" :rows="3" /></el-form-item>
            </el-col>
          </el-row>
        </el-form>
        <div class="info-foot">
          <el-button @click="sbDrawerVisible = false">关闭</el-button>
          <el-button type="primary" :loading="sbSaving" @click="saveSbInline">保存分镜到数据库</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- ============== 内嵌场景节点 Drawer（画布点击场景节点打开） ============== -->
    <el-drawer v-model="sceneDrawerVisible" :title="editingScene ? `场景编辑：${editingScene.location || ''}` : '场景编辑'" direction="rtl" size="480px">
      <div v-if="editingScene" class="info-section">
        <div class="info-section-title-row">
          <div class="info-section-title">场景核心信息（直接写入 MySQL）</div>
          <el-button size="small" link type="danger" style="margin-left:auto" @click="deleteSceneInline">删除此场景</el-button>
        </div>
        <el-form label-width="90px" label-position="left">
          <el-form-item label="地点"><el-input v-model="editingScene.location" /></el-form-item>
          <el-form-item label="时间段">
            <el-select v-model="editingScene.time" style="width:100%">
              <el-option v-for="v in ['day','night','dawn','dusk','morning','midnight']" :key="v" :label="v" :value="v" />
            </el-select>
          </el-form-item>
          <el-form-item label="氛围/描述"><el-input v-model="editingScene.description" type="textarea" :rows="4" /></el-form-item>
          <el-form-item label="视觉风格"><el-input v-model="editingScene.atmosphere" type="textarea" :rows="3" placeholder="如：低饱和蓝灰、阴雨连绵、霓虹灯下" /></el-form-item>
        </el-form>
        <div class="info-foot">
          <el-button @click="sceneDrawerVisible = false">关闭</el-button>
          <el-button type="primary" :loading="sceneSaving" @click="saveSceneInline">保存场景到数据库</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- ============== S7: 智能工作流编排 Dialog ============== -->
    <WorkflowOrchestrator
      :drama-id="dramaId"
      :visible="wfOrchVisible"
      @update:visible="wfOrchVisible = $event"
      @instance-created="onWorkflowInstanceCreated"
    />

    <!-- ============== S7: 工作流执行监控 Dialog ============== -->
    <WorkflowMonitor
      v-if="wfMonitorVisible"
      :drama-id="dramaId"
      :instance-id="wfMonitorInstanceId"
      @close="wfMonitorVisible = false"
    />

    <!-- ============== S7: 智能剪辑工作台 Dialog ============== -->
    <SmartEditTimeline
      ref="smartEditRef"
      :drama-id="dramaId"
      @edit-completed="onEditCompleted"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { List, Moon, Plus, Sunny, FullScreen, Connection, Monitor, VideoCamera } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

import ProjectNavTree from './ProjectNavTree.vue'
import WorkbenchCanvas from './WorkbenchCanvas.vue'
import WorkbenchAIPanel from './WorkbenchAIPanel.vue'
import StoryboardTimeline from './StoryboardTimeline.vue'
import CharacterConsistencyPanel from './CharacterConsistencyPanel.vue'
// S7: 智能工作流编排 + 智能剪辑组件
import WorkflowOrchestrator from '@/components/workbench/WorkflowOrchestrator.vue'
import WorkflowMonitor from '@/components/workbench/WorkflowMonitor.vue'
import SmartEditTimeline from '@/components/workbench/SmartEditTimeline.vue'

import { dramaAPI } from '@/api/drama'
import { characterAPI } from '@/api/characters'
import { sceneAPI } from '@/api/scenes'
import { storyboardsAPI } from '@/api/storyboards'
import { ttsPipelineAPI } from '@/api/ttsPipeline'
import { imagesAPI } from '@/api/images'
import { useTheme } from '@localmini/shared/composables/useTheme'
import { useWorkbenchLogger } from '@/composables/useWorkbenchLogger'

const route = useRoute()
const router = useRouter()
const { isDark, toggle: toggleTheme } = useTheme()
const log = useWorkbenchLogger('DramaWorkbench')

const dramaId = computed(() => Number(route.params.id))

/* ==================== 数据状态 ==================== */
const drama = ref(null)
const filterEpisodeId = ref('all')
const storyboards = computed(() => {
  const list = []
  for (const ep of (drama.value?.episodes || [])) {
    for (const sb of (ep.storyboards || [])) list.push({ ...sb, episode_id: ep.id })
  }
  return list
})
const audios = computed(() => {
  const list = []
  for (const ep of (drama.value?.episodes || [])) {
    for (const sb of (ep.storyboards || [])) {
      if (sb.audio_path || sb.audio_url) list.push({ id: `a-${sb.id}`, name: `分镜#${sb.storyboard_number} 配音`, storyboard_id: sb.id })
    }
  }
  return list
})
const framesForTimeline = computed(() => {
  // 为 Timeline 提供分镜数据 + 一致性分数 + 重试次数（从image_generations的最新记录获取）
  const frames = []
  for (const sb of storyboards.value) {
    if (filterEpisodeId.value !== 'all' && String(sb.episode_id) !== String(filterEpisodeId.value)) continue
    frames.push({
      ...sb,
      consistency_score: sb.consistency_score ?? (sb.latest_image?.consistency_score),
      consistency_passed: sb.consistency_passed ?? (sb.latest_image?.consistency_passed),
      retry_count: sb.retry_count ?? (sb.latest_image?.retry_count) ?? 0,
    })
  }
  return frames
})

/* ==================== 布局尺寸（可拖动调整 + 边界检查 + localStorage持久化） ==================== */
// S3-T05 严格尺寸约束（极端小窗口下仍保留最小中间区域，避免三栏/时间轴溢出）
const HEADER_HEIGHT = 56
const LAYOUT_DEFAULTS = Object.freeze({
  left: 260, right: 360, timeline: 220,
})
const LAYOUT_BOUNDS = Object.freeze({
  left:     { min: 180, max: 420 },
  right:    { min: 260, max: 520 },   // AI面板最小260px(比原240更大)，保证控件不换行
  timeline: { min: 120, max: 420 },  // 时间轴最小降到 120（极端矮屏），原 140
  center:   { minW: 320, minH: 200 },// 极端窗口下中间画布保底 320x200（原 420x260 在 13"MBP 小屏太苛刻）
})
const LAYOUT_LS_KEY = computed(() => `wb:layout:v1:${dramaId.value}`)
const LAYOUT_LS_VER = 1

function _px(v) {
  // 防御非法输入：undefined/NaN/Infinity/字符串非数字/负值 → 返回 0
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') {
    if (!isFinite(v)) return 0
    return v < 0 ? 0 : Math.floor(v)
  }
  const n = parseInt(String(v), 10)
  if (!isFinite(n)) return 0
  return n < 0 ? 0 : n
}
function _clamp(val, min, max) { return Math.max(min, Math.min(max, val)) }
// 合法性校验：确保 payload 所有字段都是有限正整数，避免 localStorage 损坏值搞乱布局
function _sanitizeLayoutPayload(raw) {
  const out = {
    leftPx: LAYOUT_DEFAULTS.left,
    rightPx: LAYOUT_DEFAULTS.right,
    timelinePx: LAYOUT_DEFAULTS.timeline,
    rightCollapsed: false,
    v: LAYOUT_LS_VER,
    ts: Date.now(),
  }
  if (!raw || typeof raw !== 'object') return out
  if (typeof raw.leftPx === 'number' && isFinite(raw.leftPx) && raw.leftPx > 0) out.leftPx = Math.floor(raw.leftPx)
  if (typeof raw.rightPx === 'number' && isFinite(raw.rightPx) && raw.rightPx >= 0) out.rightPx = Math.floor(raw.rightPx)
  if (typeof raw.timelinePx === 'number' && isFinite(raw.timelinePx) && raw.timelinePx > 0) out.timelinePx = Math.floor(raw.timelinePx)
  if (typeof raw.rightCollapsed === 'boolean') out.rightCollapsed = raw.rightCollapsed
  return out
}

/**
 * 按窗口尺寸做强制 clamp：保证
 *   L + R + Center.minW ≤ window.innerWidth
 *   Timeline + Center.minH ≤ 可用高度
 * 小于阈值时：
 *   - 水平：优先压缩右栏 → 再压左栏 → 最后强制折叠 AI (rightPx=0)
 *   - 垂直：优先压缩 timeline → 仍不满足时 timeline=min(120) 允许 center 略低于 minH 但保证不溢出
 * @param {boolean} opts.rightIsCollapsed - AI 是否已折叠（折叠状态下 rightPx 允许为 0，不再参与 min 约束）
 * @returns {{ leftPx, rightPx, timelinePx, autoFoldedRight: boolean }}
 */
function _enforceViewportConstraint(leftPx, rightPx, timelinePx, { warn = true, rightIsCollapsed = false } = {}) {
  const canUseWin = typeof window !== 'undefined' && typeof window.innerWidth === 'number' && typeof window.innerHeight === 'number'
  const rawW = canUseWin ? window.innerWidth : 1440
  const rawH = canUseWin ? window.innerHeight : 900
  // 1) 极端窗口值防御：宽度 < 240 或 高度 < 320 时按最小可用值兜底（比如手机横屏）
  const W = Math.max(240, isFinite(rawW) ? rawW : 1440)
  const bodyH = Math.max(320, isFinite(rawH) ? rawH : 900)
  const H = Math.max(280, bodyH - HEADER_HEIGHT)
  const detail = { winW: W, winH: H, rightIsCollapsed, input: { leftPx, rightPx, timelinePx } }
  let autoFoldedRight = false

  // ———— ① 水平约束 ————
  let finalLeft = _clamp(leftPx, LAYOUT_BOUNDS.left.min, LAYOUT_BOUNDS.left.max)
  let finalRight = rightIsCollapsed
    ? 0   // 折叠状态：宽度强制 0，不再参与 min 约束
    : _clamp(rightPx, LAYOUT_BOUNDS.right.min, LAYOUT_BOUNDS.right.max)

  // 第一步：压右栏（若未折叠）
  if (!rightIsCollapsed) {
    const maxRAfterLeft = Math.max(0, W - finalLeft - LAYOUT_BOUNDS.center.minW)
    if (finalRight > maxRAfterLeft) {
      if (maxRAfterLeft >= LAYOUT_BOUNDS.right.min) {
        finalRight = maxRAfterLeft
      } else {
        // 连右栏最小值都放不下 → 自动折叠（宽度=0）
        finalRight = 0
        autoFoldedRight = true
      }
    }
  }
  // 第二步：压左栏（即使右栏已折叠，也要保证 center≥minW）
  const maxL = Math.max(LAYOUT_BOUNDS.left.min, W - finalRight - LAYOUT_BOUNDS.center.minW)
  if (finalLeft > maxL) finalLeft = maxL
  // 最后兜底：强制保证 W 不溢出（极端窄屏 < 320+180 = 500 时）
  if (finalLeft + finalRight + LAYOUT_BOUNDS.center.minW > W) {
    finalLeft = Math.max(140, W - finalRight - LAYOUT_BOUNDS.center.minW)
  }
  // 再 clamp 一次，避免极端值让 finalLeft 低于 140 溢出到负值
  finalLeft = _clamp(finalLeft, 140, LAYOUT_BOUNDS.left.max)

  // ———— ② 垂直约束 ————
  let finalTimeline = _clamp(timelinePx, LAYOUT_BOUNDS.timeline.min, LAYOUT_BOUNDS.timeline.max)
  const maxT = Math.max(LAYOUT_BOUNDS.timeline.min, H - LAYOUT_BOUNDS.center.minH)
  if (finalTimeline > maxT) finalTimeline = maxT
  // 最终兜底：timeline + center 绝对不能 > H（CSS 用 flex 也会被挤乱，所以精确数值保证）
  if (finalTimeline + LAYOUT_BOUNDS.center.minH > H) {
    finalTimeline = Math.max(80, H - LAYOUT_BOUNDS.center.minH)
  }
  finalTimeline = _clamp(finalTimeline, 80, LAYOUT_BOUNDS.timeline.max)

  // ———— ③ 最终一致性校验（总和超限强制折减，防止某条计算路径出 bug） ————
  const sumH = finalTimeline + LAYOUT_BOUNDS.center.minH
  if (sumH > H) {
    finalTimeline = Math.max(80, H - LAYOUT_BOUNDS.center.minH)
    log.warn('[Layout] 垂直约束最后兜底折减 timeline', { before: detail.input.timelinePx, after: finalTimeline, sumH, H })
  }
  const sumW = finalLeft + finalRight + LAYOUT_BOUNDS.center.minW
  if (sumW > W) {
    const needReduce = sumW - W
    finalLeft = Math.max(140, finalLeft - needReduce)
    log.warn('[Layout] 水平约束最后兜底折减 left', { before: detail.input.leftPx, after: finalLeft, needReduce, sumW, W })
  }
  // 最终再 clamp 一次防止负数/越界
  finalLeft = _clamp(finalLeft, 140, LAYOUT_BOUNDS.left.max)
  finalRight = rightIsCollapsed ? 0 : Math.max(0, finalRight)
  finalTimeline = _clamp(finalTimeline, 80, LAYOUT_BOUNDS.timeline.max)

  const folded = {
    left: finalLeft !== leftPx,
    right: finalRight !== rightPx,
    timeline: finalTimeline !== timelinePx,
    autoFoldedRight,
  }
  if (warn && (folded.left || folded.right || folded.timeline)) {
    log.warn('[Layout] 窗口尺寸约束，已强制 clamp 布局尺寸避免错乱', {
      ...detail,
      clamped: { left: finalLeft, right: finalRight, timeline: finalTimeline },
      folded,
    })
  }
  return { leftPx: finalLeft, rightPx: finalRight, timelinePx: finalTimeline, autoFoldedRight }
}

function _persistLayout({ leftPx, rightPx, timelinePx, rightCollapsed }) {
  if (typeof localStorage === 'undefined') return  // SSR / 测试环境防御
  try {
    // 写入前再做一次 sanitize + 合法性校验
    const clean = _sanitizeLayoutPayload({ leftPx, rightPx, timelinePx, rightCollapsed })
    if (!isFinite(clean.leftPx) || !isFinite(clean.rightPx) || !isFinite(clean.timelinePx)) {
      throw new Error('sanitize 后仍存在非有限数值')
    }
    const payload = { ...clean, v: LAYOUT_LS_VER, ts: Date.now() }
    localStorage.setItem(LAYOUT_LS_KEY.value, JSON.stringify(payload))
    log.debug('[Layout] 已持久化布局尺寸到 localStorage', { key: LAYOUT_LS_KEY.value, ...payload })
  } catch (e) {
    log.warn('[Layout] localStorage 持久化失败（可能隐私模式/配额超了/序列化异常）', {
      msg: e?.message || String(e),
      name: e?.name || '',
    })
  }
}

function _restoreLayout() {
  if (typeof localStorage === 'undefined') {
    log.warn('[Layout] 无 localStorage（SSR/测试环境），使用默认值')
    return null
  }
  try {
    const raw = localStorage.getItem(LAYOUT_LS_KEY.value)
    if (!raw) {
      log.info('[Layout] 首次加载，无 localStorage 布局记录，使用默认尺寸', { key: LAYOUT_LS_KEY.value })
      return null
    }
    // 防御：异常长字符串（被污染/损坏），超过 1KB 直接丢弃
    if (raw.length > 1024) {
      log.warn('[Layout] localStorage 布局数据异常过长，丢弃并移除', { len: raw.length })
      try { localStorage.removeItem(LAYOUT_LS_KEY.value) } catch (_) { /* noop */ }
      return null
    }
    const parsed = JSON.parse(raw)
    // LS 版本兼容（v=1 是当前）
    if (!parsed || typeof parsed !== 'object' || typeof parsed.v !== 'number' || parsed.v < LAYOUT_LS_VER) {
      log.warn('[Layout] localStorage 布局版本过旧或格式异常，丢弃并使用默认值', { storedVer: parsed?.v, expect: LAYOUT_LS_VER })
      try { localStorage.removeItem(LAYOUT_LS_KEY.value) } catch (_) { /* noop */ }
      return null
    }
    // sanitize 清理脏数据（比如之前代码保存了 NaN/字符串/undefined）
    const clean = _sanitizeLayoutPayload(parsed)
    const collapsed = !!clean.rightCollapsed
    const rawLeftPx = clean.leftPx
    const rawRightPx = collapsed ? LAYOUT_DEFAULTS.right : clean.rightPx || LAYOUT_DEFAULTS.right
    const rawTimelinePx = clean.timelinePx || LAYOUT_DEFAULTS.timeline

    const leftPx = _clamp(rawLeftPx, LAYOUT_BOUNDS.left.min, LAYOUT_BOUNDS.left.max)
    const rightPxBefore = _clamp(rawRightPx, LAYOUT_BOUNDS.right.min, LAYOUT_BOUNDS.right.max)
    const timelinePx = _clamp(rawTimelinePx, LAYOUT_BOUNDS.timeline.min, LAYOUT_BOUNDS.timeline.max)

    const result = _enforceViewportConstraint(leftPx, rightPxBefore, timelinePx, { warn: true, rightIsCollapsed: collapsed })
    log.info('[Layout] 从 localStorage 恢复布局尺寸', {
      key: LAYOUT_LS_KEY.value,
      stored: { leftPx: clean.leftPx, rightPx: clean.rightPx, timelinePx: clean.timelinePx, rightCollapsed: collapsed, ts: parsed.ts || null },
      applied: { leftPx: result.leftPx, rightPx: result.rightPx, timelinePx: result.timelinePx, autoFolded: result.autoFoldedRight },
    })
    // 自动折叠了也要同步状态
    const finalCollapsed = collapsed || result.autoFoldedRight
    // 恢复后若尺寸被 clamp 调整 → 立刻回写一份到 localStorage，确保下次直接加载有效值
    if (result.leftPx !== clean.leftPx || (result.rightPx !== clean.rightPx && !finalCollapsed) || result.timelinePx !== clean.timelinePx || result.autoFoldedRight !== !!parsed.autoFoldedRight) {
      log.debug('[Layout] 恢复后尺寸已被自动调整，立刻回写 localStorage')
      _persistLayout({ leftPx: result.leftPx, rightPx: result.rightPx, timelinePx: result.timelinePx, rightCollapsed: finalCollapsed })
    }
    return { ...result, rightCollapsed: finalCollapsed }
  } catch (e) {
    log.warn('[Layout] 从 localStorage 恢复失败，使用默认尺寸', { msg: e?.message || String(e), name: e?.name || '' })
    try { localStorage.removeItem(LAYOUT_LS_KEY.value) } catch (_) { /* noop */ }
    return null
  }
}

// —— 初始化（LS 优先，其次 viewport-clamped 默认值）
const restored = _restoreLayout() || (() => {
  const d = _enforceViewportConstraint(LAYOUT_DEFAULTS.left, LAYOUT_DEFAULTS.right, LAYOUT_DEFAULTS.timeline, { warn: false, rightIsCollapsed: false })
  return { ...d, rightCollapsed: d.autoFoldedRight }
})()
const leftColWidth = ref(restored.leftPx + 'px')
const rightColWidth = ref(restored.rightPx + 'px')
const timelineHeight = ref(restored.timelinePx + 'px')
const centerRowHeight = computed(() => `calc(100% - ${timelineHeight.value})`)
// 折叠状态（从 LS 恢复）
const aiPanelCollapsed = ref(!!restored.rightCollapsed)
// 记录未折叠时的右栏宽度，用于展开时恢复
const _lastExpandedRightPx = ref(
  restored.rightPx && !restored.rightCollapsed ? restored.rightPx : LAYOUT_DEFAULTS.right
)

let _resizeCfg = null
let _resizeStartAt = 0

function startResize(e, direction) {
  // 折叠状态下不允许拖右栏分隔条（展开状态才允许）
  if (direction === 'right' && aiPanelCollapsed.value) {
    log.info('[Layout] 忽略右栏拖动：AI面板已折叠')
    return
  }
  // 防御重复 mousedown（比如系统级丢失 mouseup 导致下次拖动误触发）
  if (_resizeCfg) {
    log.warn('[Layout] 发现上次拖动未清理，强制清理残留监听器')
    try { _onResizeEnd(true) } catch (_) { /* noop */ }
  }
  _resizeStartAt = Date.now()
  _resizeCfg = {
    direction, startX: e.clientX, startY: e.clientY,
    left: _px(leftColWidth.value),
    right: _px(rightColWidth.value),
    bottom: _px(timelineHeight.value),
  }
  document.addEventListener('mousemove', _onResizeMove)
  document.addEventListener('mouseup', _onResizeEnd)
  document.addEventListener('mouseleave', _onResizeEnd)
  document.body.style.cursor = { left: 'col-resize', right: 'col-resize', bottom: 'row-resize' }[direction] || 'col-resize'
  document.body.style.userSelect = 'none'
  log.info('[Layout] 开始拖动分隔条', { direction, start: { ..._resizeCfg }, rightCollapsed: aiPanelCollapsed.value })
}

function _onResizeMove(e) {
  if (!_resizeCfg) return
  try {
    const dx = e.clientX - _resizeCfg.startX
    const dy = e.clientY - _resizeCfg.startY

    let nextLeft = _px(leftColWidth.value)
    let nextRight = _px(rightColWidth.value)
    let nextTimeline = _px(timelineHeight.value)

    if (_resizeCfg.direction === 'left') {
      nextLeft = _clamp(_resizeCfg.left + dx, LAYOUT_BOUNDS.left.min, LAYOUT_BOUNDS.left.max)
    } else if (_resizeCfg.direction === 'right') {
      nextRight = _clamp(_resizeCfg.right - dx, LAYOUT_BOUNDS.right.min, LAYOUT_BOUNDS.right.max)
    } else if (_resizeCfg.direction === 'bottom') {
      nextTimeline = _clamp(_resizeCfg.bottom - dy, LAYOUT_BOUNDS.timeline.min, LAYOUT_BOUNDS.timeline.max)
    }

    // 实时 viewport clamp
    const enforced = _enforceViewportConstraint(nextLeft, nextRight, nextTimeline, { warn: false, rightIsCollapsed: aiPanelCollapsed.value })
    leftColWidth.value = enforced.leftPx + 'px'
    rightColWidth.value = enforced.rightPx + 'px'
    timelineHeight.value = enforced.timelinePx + 'px'
    // 若极端窗口下自动折叠了右栏，同步状态
    if (enforced.autoFoldedRight && !aiPanelCollapsed.value) {
      aiPanelCollapsed.value = true
      log.warn('[Layout] 拖动中触发自动折叠 AI 面板（宽度过小）')
    }
  } catch (e) {
    log.error('[Layout] 分隔条拖动move处理异常，立即中止拖动', e, { direction: _resizeCfg?.direction })
    try { _onResizeEnd(true) } catch (_) { /* noop */ }
  }
}

/**
 * @param {boolean} aborted - true=拖动被中止（窗口resize/异常）→ 仍然持久化当前尺寸，但日志分类为 abort
 */
function _onResizeEnd(aborted = false) {
  document.removeEventListener('mousemove', _onResizeMove)
  document.removeEventListener('mouseup', _onResizeEnd)
  document.removeEventListener('mouseleave', _onResizeEnd)
  try {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.body.style.removeProperty?.('cursor')
    document.body.style.removeProperty?.('user-select')
  } catch (_) { /* noop */ }
  if (!_resizeCfg) return
  const dur = Date.now() - _resizeStartAt
  const finalSizes = {
    direction: _resizeCfg.direction,
    leftPx: _px(leftColWidth.value), rightPx: _px(rightColWidth.value), timelinePx: _px(timelineHeight.value),
    durMs: dur,
  }
  log.info('[Layout] 拖动分隔条结束', { ...finalSizes, rightCollapsed: aiPanelCollapsed.value, aborted: !!aborted })
  // 展开状态下记录右栏宽度（便于展开时恢复）
  if (!aiPanelCollapsed.value && finalSizes.rightPx >= LAYOUT_BOUNDS.right.min) {
    _lastExpandedRightPx.value = finalSizes.rightPx
  }
  _persistLayout({ ...finalSizes, rightCollapsed: aiPanelCollapsed.value })
  _resizeCfg = null
}

// —— 监听 AI 面板折叠：展开/收起时同步宽度 & 持久化
watch(aiPanelCollapsed, (collapsed, wasCollapsed) => {
  if (collapsed === wasCollapsed) return
  const t0 = Date.now()
  if (collapsed) {
    // 折叠 → 保存当前宽度后归零
    const curR = _px(rightColWidth.value)
    if (curR >= LAYOUT_BOUNDS.right.min) _lastExpandedRightPx.value = curR
    rightColWidth.value = '0px'
    log.info('[Layout] AI面板 折叠', { savedRightPx: _lastExpandedRightPx.value })
  } else {
    // 展开 → 恢复保存的宽度并 viewport clamp
    const recover = _lastExpandedRightPx.value || LAYOUT_DEFAULTS.right
    const enforced = _enforceViewportConstraint(
      _px(leftColWidth.value), recover, _px(timelineHeight.value),
      { warn: true, rightIsCollapsed: false }
    )
    leftColWidth.value = enforced.leftPx + 'px'
    rightColWidth.value = enforced.rightPx + 'px'
    timelineHeight.value = enforced.timelinePx + 'px'
    if (enforced.autoFoldedRight) {
      // 极端窄屏：展开会被立刻折回，提示用户
      aiPanelCollapsed.value = true
      ElMessage.warning('当前窗口过窄，无法展开 AI 面板，请拉宽窗口后再试')
    }
    log.info('[Layout] AI面板 展开', { recoverPx: recover, finalPx: _px(rightColWidth.value), autoFoldedBack: enforced.autoFoldedRight })
  }
  _persistLayout({
    leftPx: _px(leftColWidth.value),
    rightPx: _px(rightColWidth.value),
    timelinePx: _px(timelineHeight.value),
    rightCollapsed: aiPanelCollapsed.value,
  })
  log.debug('[Layout] 折叠切换持久化完成', { durMs: Date.now() - t0 })
})

// —— 监听窗口 resize，极端窗口下强制 clamp & 持久化
let _winResizeTimer = null
function _onWindowResize() {
  if (_resizeCfg) {
    // 竞态防护：正在拖动分隔条时，窗口尺寸改变 → 立即终止拖动，清理 document 监听器 & 光标样式
    log.warn('[Layout] 拖动中检测到窗口尺寸变化，立即中止分隔条拖动（避免坐标漂移）', {
      direction: _resizeCfg.direction,
      winW: typeof window !== 'undefined' ? window.innerWidth : 'n/a',
      winH: typeof window !== 'undefined' ? window.innerHeight : 'n/a',
    })
    try { _onResizeEnd(true) } catch (_) { /* noop */ }
  }
  if (_winResizeTimer) clearTimeout(_winResizeTimer)
  // 窗口事件高频场景（最大化/还原）下防抖 60ms
  _winResizeTimer = setTimeout(() => {
    const t0 = Date.now()
    const curL = _px(leftColWidth.value)
    const curR = _px(rightColWidth.value)
    const curT = _px(timelineHeight.value)
    const before = { leftPx: curL, rightPx: curR, timelinePx: curT }
    try {
      const after = _enforceViewportConstraint(curL, curR, curT, { warn: true, rightIsCollapsed: aiPanelCollapsed.value })
      if (after.leftPx !== before.leftPx) leftColWidth.value = after.leftPx + 'px'
      if (after.rightPx !== before.rightPx) rightColWidth.value = after.rightPx + 'px'
      if (after.timelinePx !== before.timelinePx) timelineHeight.value = after.timelinePx + 'px'
      // 自动折叠同步
      if (after.autoFoldedRight && !aiPanelCollapsed.value) {
        aiPanelCollapsed.value = true
        log.warn('[Layout] 窗口resize触发自动折叠 AI 面板')
      }
      if (after.leftPx !== before.leftPx || after.rightPx !== before.rightPx || after.timelinePx !== before.timelinePx || after.autoFoldedRight) {
        log.warn('[Layout] 窗口尺寸变更，已重新 clamp', {
          winW: typeof window !== 'undefined' ? window.innerWidth : 'n/a',
          winH: typeof window !== 'undefined' ? window.innerHeight : 'n/a',
          before, after: { leftPx: after.leftPx, rightPx: after.rightPx, timelinePx: after.timelinePx, autoFoldedRight: after.autoFoldedRight },
          durMs: Date.now() - t0,
        })
        _persistLayout({ ...after, rightCollapsed: aiPanelCollapsed.value })
      } else {
        log.debug('[Layout] 窗口变更尺寸无需调整（仍在约束范围内）', {
          winW: typeof window !== 'undefined' ? window.innerWidth : 'n/a',
          winH: typeof window !== 'undefined' ? window.innerHeight : 'n/a',
          before, durMs: Date.now() - t0,
        })
      }
    } catch (e) {
      log.error('[Layout] 窗口resize处理异常', e, { before })
    }
  }, 60)
}
if (typeof window !== 'undefined') {
  window.addEventListener('resize', _onWindowResize, { passive: true })
  window.addEventListener('orientationchange', _onWindowResize, { passive: true })
}
onBeforeUnmount(() => {
  // 收尾：可能仍在拖动中 → 取消；解绑窗口事件；持久化最终布局
  if (_winResizeTimer) clearTimeout(_winResizeTimer)
  _onResizeEnd()
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', _onWindowResize)
    window.removeEventListener('orientationchange', _onWindowResize)
  }
  const finalPayload = {
    leftPx: _px(leftColWidth.value),
    rightPx: _px(rightColWidth.value),
    timelinePx: _px(timelineHeight.value),
    rightCollapsed: aiPanelCollapsed.value,
  }
  log.info('[Layout] 组件卸载，持久化最终布局', finalPayload)
  _persistLayout(finalPayload)
})

/* ==================== Canvas 回调 ==================== */
const wbCanvasRef = ref(null)
const layoutState = ref('idle')
const canvasFocusSbId = ref(null)        // 画布→时间轴：当前画布点击的分镜
const timelineFocusSbId = ref(null)      // 时间轴→画布：点击缩略图要求画布聚焦
const highlightAssetId = ref(null)
const treeSelectedKey = ref('script:root')
// aiPanelCollapsed 已在 417 行从 LS 恢复声明

// ---- S4-T04: 配音数据（时间轴音画同步） ----
const dubbingMap = ref({})
async function loadDubbingData(d) {
  if (!d?.episodes?.length) return
  const map = {}
  for (const ep of d.episodes) {
    try {
      const res = await ttsPipelineAPI.listDubbingByEpisode(ep.id)
      const items = res?.data?.items || []
      for (const item of items) {
        if (item.storyboardId && item.durationMs) {
          map[item.storyboardId] = {
            durationMs: item.durationMs,
            audioPath: item.audioPath,
            characterName: item.characterName,
            text: item.dialogueText,
          }
        }
      }
    } catch (e) {
      log.warn('[TTS] 加载分集配音数据失败', { episodeId: ep.id, msg: e?.message })
    }
  }
  dubbingMap.value = map
  log.info('[TTS] 配音数据加载完成', { count: Object.keys(map).length, episodes: d.episodes.length })
}

/**
 * 从 axios / fetch / 自定义错误中提取可读错误信息
 * 返回 { status, code, message, hint }
 */
function _extractErr(e) {
  let status = null, code = null, message = e?.message || '未知错误', hint = ''
  // axios 响应错误
  if (e?.response) {
    status = e.response.status
    const data = e.response.data || {}
    code = data.code || data.errCode || status
    message = typeof data === 'string'
      ? data.slice(0, 120)
      : (data.message || data.msg || data.error || `HTTP ${status}`).toString().slice(0, 120)
    if (status === 401) hint = '登录已过期，请刷新页面重新登录'
    else if (status === 403) hint = '无权限，请联系管理员'
    else if (status === 404) hint = '接口不存在，请确认后端已启动'
    else if (status >= 500) hint = '后端服务异常，请检查后端日志'
  } else if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
    hint = '请求超时，请检查网络或重试'
  } else if (e?.code === 'ERR_NETWORK' || /network/.test(e?.message || '')) {
    hint = '网络错误，无法连接后端'
  }
  return { status, code, message, hint }
}

/**
 * S4-T04: 音画对齐 — 根据配音时长更新分镜 duration 并持久化
 *
 * 错误捕获与提示流程：
 * 1. 对齐前（子组件已完成偏差分析+异常跳过，父组件接收详细 result）
 * 2. 本地数据更新 → 逐条持久化
 * 3. 收集失败详情（哪条分镜、HTTP 状态、错误消息、解决建议）
 * 4. 失败率 > 0 时用 ElMessageBox 展示完整失败列表，支持"稍后重试"指引
 * 5. 失败率高（≥50% 或 ≥3 条）使用 error 级对话框，引导用户排查
 */
async function onTimelineAlignDuration(result) {
  // 解构新的 result 格式（兼容旧格式 { updated, aligned }）
  const updated = result?.updated || []
  const aligned = result?.aligned ?? 0
  const analysisReport = result?.analysisReport || null
  const skipped = result?.skippedItems || []

  if (!aligned) {
    log.info('[Timeline→Workbench] 对齐事件：无需要更新的分镜', { skipped: skipped.length })
    // 子组件已提示，此处省略重复消息
    return
  }
  log.info('[Timeline→Workbench] 音画对齐：持久化分镜时长', {
    aligned, total: updated.length,
    suspicious: analysisReport?.suspicious?.length || 0,
    skippedItems: skipped.length,
  })
  let saved = 0
  let failed = 0
  const failedItems = []  // { storyboardId, storyboardNum, durationSec, status, code, message, hint }

  // 更新本地 drama.value 中分镜的 duration_sec（先乐观更新 UI，失败再手动回滚）
  const updatedIds = new Set(updated.filter(f => f.duration_sec != null).map(f => f.id))
  const frameById = new Map()
  for (const f of updated) frameById.set(f.id, f)

  for (const ep of (drama.value?.episodes || [])) {
    for (const sb of (ep.storyboards || [])) {
      const u = frameById.get(sb.id)
      if (u && u.duration_sec != null) {
        sb.duration_sec = u.duration_sec
        sb.duration = u.duration_sec + 's'
      }
    }
  }

  // 持久化到后端（逐条更新，避免批量接口不存在）
  for (const f of updated) {
    if (!f.id || f.duration_sec == null || !updatedIds.has(f.id)) continue
    try {
      await storyboardsAPI.update(f.id, { duration: String(f.duration_sec) })
      saved++
    } catch (e) {
      failed++
      const eInfo = _extractErr(e)
      failedItems.push({
        storyboardId: f.id,
        storyboardNum: f.storyboard_number || f.storyboardNumber || f.id,
        durationSec: f.duration_sec,
        ...eInfo,
      })
      log.warn('[Timeline→Workbench] 分镜时长持久化失败', {
        storyboardId: f.id,
        durationSec: f.duration_sec,
        ...eInfo,
      })
    }
  }
  log.info('[Timeline→Workbench] 音画对齐持久化完成', { saved, failed, failedItems })

  // 失败详情展示
  if (failed > 0) {
    const failRate = failed / (saved + failed)
    const critical = failRate >= 0.5 || failed >= 3

    const lines = [
      `共 ${saved + failed} 条分镜需要保存：`,
      `• ✅ 保存成功：${saved} 条`,
      `• ❌ 保存失败：${failed} 条（失败率 ${(failRate*100).toFixed(0)}%）`,
      '',
    ]
    if (skipped.length > 0) {
      lines.push(`• ⚠️ 未对齐（时长异常）：${skipped.length} 条`)
    }
    lines.push('')
    if (failedItems.length > 0) {
      lines.push('失败分镜详情：')
      const display = failedItems.slice(0, 6)
      for (const it of display) {
        const tag = it.status ? `[HTTP${it.status}]` : (it.code ? `[${it.code}]` : '')
        lines.push(`  - 分镜 #${it.storyboardNum}（→${it.durationSec}s）${tag} ${it.message}`)
        if (it.hint) lines.push(`    💡 ${it.hint}`)
      }
      if (failedItems.length > 6) lines.push(`  ...另有 ${failedItems.length - 6} 条失败`)
    }
    lines.push('')
    lines.push(critical
      ? '💥 失败率较高，建议先排查后端连接（登录态/网络/服务状态），再点击"重试保存"。'
      : '建议点击"重试保存"，或稍后进入分镜编辑页面手动修正。')

    await ElMessageBox.alert(lines.join('\n'), `音画对齐保存：${failed} 条失败`, {
      type: critical ? 'error' : 'warning',
      confirmButtonText: critical ? '我知道了（请先排查）' : '好的',
      customClass: 'align-save-error-dialog',
    }).catch(() => {})
  } else {
    ElMessage.success(`音画对齐：${saved} 条分镜时长已保存到服务器`)
  }
}

function onDramaLoaded(d) {
  drama.value = d
  // 默认选中第一集（若有）
  if (!drama.value?.episodes?.length) return
  filterEpisodeId.value = drama.value.episodes[0]?.id || 'all'
  // S4-T04: 加载配音数据用于时间轴音画同步
  loadDubbingData(d)
  // 初始化剧集资料 Drawer 的表单预填
  infoDrawerForm.title = d.title || ''
  infoDrawerForm.description = d.description || ''
  infoDrawerForm.style = d.style || ''
  infoDrawerForm.aspect_ratio = d.metadata?.aspect_ratio || '16:9'
  infoDrawerScript.idea = d.script?.idea || d.metadata?.script?.idea || d.description || ''
  infoDrawerScript.template = d.metadata?.script?.template || 'three_act'
  infoDrawerScript.act1 = d.outline?.act1 || d.metadata?.script?.act1 || ''
  infoDrawerScript.act2 = d.outline?.act2 || d.metadata?.script?.act2 || ''
  infoDrawerScript.act3 = d.outline?.act3 || d.metadata?.script?.act3 || ''
  infoDrawerScript.tags = d.genre || ''
}
/* ==================== 画布节点点击 → 按类型打开内嵌 Drawer（S3-T05 核心：整合剧本/角色/场景/分镜管理） ==================== */
function onCanvasNodeClick(p) {
  const end = log.startMeasure('CanvasNodeClickDispatch')
  try {
    const nodeType = String(p?.nodeType || '').toLowerCase()
    const id = p?.id
    const data = p?.data || {}
    log.info('[Canvas→Workbench] 画布节点点击 → 打开对应类型内嵌管理 Drawer', {
      nodeType, id, label: data.label || p?.label || null,
    })
    // ——— 角色节点 → 打开角色一致性 Drawer + 顺带切编辑入口 ——
    if (nodeType.includes('character') || /char/i.test(id || '')) {
      const cid = extractIdFromNodeId(id || data.id || data?.character_id)
      const found = findCharacterById(cid)
      if (found) {
        selectedCharacter.value = found
        charDrawerVisible.value = true
        highlightAssetId.value = `char:${cid}`
        end(true, { match: 'character', cid })
        return
      }
    }
    // ——— 分镜节点 → 打开分镜编辑 Drawer（S3-T05 验收点：在工作台内管理分镜，无需跳页面） ——
    if (nodeType.includes('storyboard') || /^sb-|^storyboard/i.test(id || '')) {
      const sid = extractIdFromNodeId(id || data.id || data?.storyboard_id)
      const sb = findStoryboardById(sid)
      if (sb) {
        openSbEditor(sb)
        canvasFocusSbId.value = sid
        treeSelectedKey.value = `storyboard:${sid}`
        end(true, { match: 'storyboard', sid })
        return
      }
    }
    // ——— 场景节点 → 打开场景编辑 Drawer ——
    if (nodeType.includes('scene') || /^scene-/i.test(id || '')) {
      const scid = extractIdFromNodeId(id || data.id || data?.scene_id)
      const sc = findSceneById(scid)
      if (sc) {
        openSceneEditor(sc)
        highlightAssetId.value = `scene:${scid}`
        end(true, { match: 'scene', scid })
        return
      }
    }
    // ——— 剧本/大纲节点 → 打开剧本大纲 Drawer ——
    if (nodeType.includes('script') || /^script|^outline/i.test(id || '')) {
      scriptDrawerForm.idea = infoDrawerScript.idea
      scriptDrawerForm.template = infoDrawerScript.template
      scriptDrawerForm.act1 = infoDrawerScript.act1
      scriptDrawerForm.act2 = infoDrawerScript.act2
      scriptDrawerForm.act3 = infoDrawerScript.act3
      scriptDrawerVisible.value = true
      treeSelectedKey.value = 'script:root'
      end(true, { match: 'script' })
      return
    }
    // ——— 道具节点 → 提示信息 ——
    if (nodeType.includes('prop') || /^prop-/i.test(id || '')) {
      highlightAssetId.value = `prop:${extractIdFromNodeId(id || data.id)}`
      ElMessage.info('道具节点内嵌管理：Sprint 4 扩展（当前已完成画布高亮）')
      end(true, { match: 'prop' })
      return
    }
    // 兜底：未知节点类型
    log.warn('[Canvas→Workbench] 未知节点类型，未匹配到 Drawer 类型', { nodeType, id })
    end(false, { match: 'none', nodeType, id })
  } catch (e) {
    end(false, { errMsg: e?.message })
    log.error('[Canvas→Workbench] 画布节点点击处理异常', e, { payloadId: p?.id, payloadType: p?.nodeType })
    ElMessage.error('打开内嵌管理面板失败：' + (e?.message || '未知错误'))
  }
}
function onCanvasStoryboardClick(sb) {
  const end = log.startMeasure('CanvasStoryboardClick')
  try {
    log.info('[Canvas→Workbench] 分镜节点直接点击 → 时间轴高亮+树同步+打开分镜Drawer', {
      storyboardId: sb?.id, number: sb?.storyboard_number || null,
    })
    canvasFocusSbId.value = sb?.id
    treeSelectedKey.value = `storyboard:${sb.id}`
    if (sb?.id) openSbEditor(sb)
    end(true, { storyboardId: sb?.id })
  } catch (e) {
    end(false, { errMsg: e?.message })
    log.error('[Canvas→Workbench] 分镜节点点击处理异常', e, { storyboardId: sb?.id })
    ElMessage.error('打开分镜面板失败：' + (e?.message || '未知错误'))
  }
}
function onCanvasScriptClick() {
  const end = log.startMeasure('CanvasScriptClick')
  try {
    treeSelectedKey.value = 'script:root'
    scriptDrawerForm.idea = infoDrawerScript.idea
    scriptDrawerForm.template = infoDrawerScript.template
    scriptDrawerForm.act1 = infoDrawerScript.act1
    scriptDrawerForm.act2 = infoDrawerScript.act2
    scriptDrawerForm.act3 = infoDrawerScript.act3
    scriptDrawerVisible.value = true
    end(true)
  } catch (e) {
    end(false, { errMsg: e?.message })
    log.error('[Canvas→Workbench] 剧本节点点击处理异常', e)
    ElMessage.error('打开剧本面板失败：' + (e?.message || '未知错误'))
  }
}
function onCanvasLayoutSaved(p) {
  log.info('[Canvas→Workbench] 画布布局保存回调', {
    ok: p?.ok ?? true, nodes: p?.nodes ?? 'n/a', totalMs: p?.totalMs ?? 'n/a',
  })
  layoutState.value = 'saved'
  setTimeout(() => (layoutState.value = 'idle'), 1500)
}
function onCanvasSelectionChange(ids) {
  log.debug('[Canvas→Workbench] 选区变更（预留回调）', {
    count: ids?.length ?? 0, sampleIds: (ids || []).slice(0, 5),
  })
}

/* ==================== 内嵌 Drawer 工具函数：从 nodeId 中提取数据库数字 ID ==================== */
function extractIdFromNodeId(raw) {
  if (!raw) return null
  if (typeof raw === 'number') return raw
  const m = String(raw).match(/(\d+)/)
  return m ? Number(m[1]) : null
}
function findCharacterById(cid) {
  if (!cid) return null
  return (drama.value?.characters || []).find(c => Number(c.id) === Number(cid)) || null
}
function findStoryboardById(sid) {
  if (!sid) return null
  return storyboards.value.find(sb => Number(sb.id) === Number(sid)) || null
}
function findSceneById(scid) {
  if (!scid) return null
  return (drama.value?.scenes || []).find(s => Number(s.id) === Number(scid)) || null
}

/* ==================== Tree 回调 (S3-T04 双向联动) ==================== */
function onTreeSelect(p) {
  const end = log.startMeasure('TreeSelectSync')
  try {
    log.info('[Tree→Workbench] 导航树节点选中 → 联动画布/时间轴/Drawer', {
      key: p?.key, type: p?.type, payloadId: p?.payload?.id ?? null, title: p?.payload?.name || p?.payload?.location || p?.payload?.title || null,
    })
    treeSelectedKey.value = p.key
    if (p.type === 'character') {
      // S3-T01: 点击角色 → 弹出一致性面板 Drawer
      selectedCharacter.value = p.payload
      charDrawerVisible.value = true
      highlightAssetId.value = `char:${p.payload?.id}`
      end(true, { sync: 'character', id: p.payload?.id })
    } else if (p.type === 'scene') {
      highlightAssetId.value = `scene:${p.payload?.id}`
      end(true, { sync: 'scene', id: p.payload?.id })
    } else if (p.type === 'prop') {
      highlightAssetId.value = `prop:${p.payload?.id}`
      end(true, { sync: 'prop', id: p.payload?.id })
    } else if (p.type === 'storyboard') {
      highlightAssetId.value = null
      timelineFocusSbId.value = p.payload?.id
      canvasFocusSbId.value = p.payload?.id
      end(true, { sync: 'storyboard', id: p.payload?.id })
    } else if (p.type === 'script') {
      focusScriptNode()
      end(true, { sync: 'script' })
    } else {
      highlightAssetId.value = null
      end(true, { sync: 'other', type: p?.type })
    }
  } catch (e) {
    end(false, { errMsg: e?.message })
    log.error('[Tree→Workbench] 导航树选中联动异常', e, { key: p?.key, type: p?.type })
    ElMessage.error('导航联动失败：' + (e?.message || '未知错误'))
  }
}
function onTreeQuickAdd(p) {
  log.info('[Tree→Workbench] 导航树快捷新建', { group: p?.groupType })
  try {
    openCreateDrawer(p.groupType?.replace('group:', '') || 'character')
  } catch (e) {
    log.error('[Tree→Workbench] 快捷新建 Drawer 打开异常', e, { group: p?.groupType })
    ElMessage.error('打开新建面板失败：' + (e?.message || '未知错误'))
  }
}

function focusScriptNode() {
  log.info('[Workbench] 定位剧本节点')
  try {
    ElMessage.info('已定位剧本节点（画布自动居中脚本节点逻辑已连接）')
    highlightAssetId.value = null
    treeSelectedKey.value = 'script:root'
  } catch (e) {
    log.error('[Workbench] 定位剧本节点异常', e)
  }
}

/* ==================== Timeline 回调 (S3-T07 双向联动) ==================== */
function onTimelineFramesUpdate(list) {
  log.info('[Timeline→Workbench] 分镜帧列表已更新（UI排序变更）', { count: list?.length || 0 })
  if (!drama.value) {
    log.warn('[Timeline→Workbench] drama未加载，跳过用户提示')
    return
  }
  ElMessage.success('分镜顺序已调整，下一步：在画布保存布局并同步 storyboard_number')
}
async function onTimelineReorder({ fromIdx, toIdx, storyboardId }) {
  const end = log.startMeasure('TimelineReorderSave')
  try {
    log.info('[Timeline→Workbench] 分镜拖拽排序（持久化storyboard_number）开始', {
      fromIdx, toIdx, storyboardId, totalFrames: framesForTimeline.value.length,
    })
    const frames = framesForTimeline.value
    const epId = frames[0]?.episode_id
    if (!epId) {
      log.warn('[Timeline→Workbench] 无episode_id，跳过保存排序')
      end(false, { reason: 'no_episode_id' })
      ElMessage.warning('当前分镜缺少所属集信息，无法保存排序')
      return
    }
    // 按顺序批量重写 storyboard_number
    const numbers = frames.map((f, i) => ({ id: f.id, storyboard_number: i + 1 }))
    let ok = 0, fail = 0
    const firstFail = { err: null, id: null }
    for (const n of numbers) {
      try {
        await storyboardsAPI.update(n.id, { storyboard_number: n.storyboard_number })
        ok++
      } catch (e) {
        fail++
        if (!firstFail.err) { firstFail.err = e; firstFail.id = n.id }
      }
    }
    const ms = end(true, { ok, fail, episodeId: epId })
    log.info('[Timeline→Workbench] 分镜排序持久化完成', { ok, fail, total: numbers.length, totalMs: ms })
    if (fail > 0) {
      log.warn('[Timeline→Workbench] 部分分镜序号保存失败，首个错误详情', {
        firstFailId: firstFail.id, msg: firstFail.err?.message, stack: (firstFail.err?.stack || '').slice(0, 300),
      })
      ElMessage.warning(`部分分镜序号保存失败：${fail}/${numbers.length}（详情见 Console）`)
    } else {
      ElMessage.success(`已保存分镜顺序：${numbers.length} 条 (${ms}ms)`)
    }
  } catch (e) {
    end(false, { errMsg: e?.message })
    log.error('[Timeline→Workbench] 分镜排序持久化异常', e, { fromIdx, toIdx, storyboardId })
    ElMessage.error('保存分镜顺序失败：' + (e?.message || '未知错误'))
  }
}
function onTimelineSelect(f) {
  const end = log.startMeasure('TimelineSelectSyncCanvas')
  try {
    log.info('[Timeline→Workbench] 点击分镜缩略图 → 画布焦点 & 树高亮联动', {
      storyboardId: f?.id, number: f?.storyboard_number, shot_type: f?.shot_type,
    })
    timelineFocusSbId.value = f.id
    canvasFocusSbId.value = f.id
    treeSelectedKey.value = `storyboard:${f.id}`
    end(true, { storyboardId: f?.id })
  } catch (e) {
    end(false, { errMsg: e?.message })
    log.error('[Timeline→Workbench] 时间轴选择联动异常', e, { storyboardId: f?.id })
    ElMessage.error('联动画布失败：' + (e?.message || '未知错误'))
  }
}
function onTimelinePlay() {
  log.info('[Timeline→Workbench] 点击预览按钮（Sprint 4 连播）', { totalFrames: framesForTimeline.value.length })
  ElMessage.success('预览模式：Sprint 4 将集成连播播放器')
}

/* ==================== AI 助手回调 (S3-T06 结果同步) ==================== */
async function onAIGenerated(p) {
  const end = log.startMeasure('AIResultSyncCanvas')
  const { kind, data } = p || {}
  try {
    log.info('[AI→Workbench] AI 生成完成 → 刷新画布 & 树 开始', {
      kind, keys: data ? Object.keys(data).slice(0, 5) : [], dataSize: JSON.stringify(data || '').length,
    })
    // 生成完成后刷新画布 & 树（含 timeout 兜底，避免 refresh 挂起卡住 UI）
    const refreshMs = await new Promise(async (resolve) => {
      const t = setTimeout(() => resolve(-1), 8000)  // 8s 兜底，极端慢接口也能继续
      try {
        const t0 = performance.now()
        await wbCanvasRef.value?.refresh()
        clearTimeout(t)
        resolve(Math.round(performance.now() - t0))
      } catch (e) {
        clearTimeout(t)
        throw e
      }
    })
    if (refreshMs === -1) {
      end(false, { kind, reason: 'refresh_timeout_8s' })
      log.warn('[AI→Workbench] 画布 refresh 超过 8s 未返回，已跳过（可能是数据量超大或后端阻塞）', { kind })
      ElMessage.warning('画布同步超时，请手动点击页面刷新以查看最新数据')
    } else {
      const ms = end(true, { kind, refreshMs })
      log.info('[AI→Workbench] AI 生成结果同步成功', { kind, refreshMs, totalMs: ms })
      ElMessage.success(`AI 生成「${kindLabel(kind)}」完成，画布/树已同步 (${ms}ms)`)
    }
  } catch (e) {
    end(false, { kind, errMsg: e?.message })
    log.error('[AI→Workbench] AI结果刷新画布失败', e, { kind })
    ElMessage.error('刷新画布失败：' + (e?.message || '请手动刷新页面查看'))
  }
}
function kindLabel(k) {
  return { outline: '大纲', characters: '角色', episodes: '分集', storyboard: '分镜', tts: '配音' }[k] || k
}
function onAIQueueUpdate(q) {
  try {
    const total = q?.queue?.length ?? 'n/a'
    const running = q?.runningCount ?? 'n/a'
    const pending = Array.isArray(q?.queue) ? q.queue.filter(x => x.status === 'pending').length : 'n/a'
    const success = Array.isArray(q?.queue) ? q.queue.filter(x => x.status === 'success').length : 'n/a'
    const failed = Array.isArray(q?.queue) ? q.queue.filter(x => x.status === 'failed').length : 'n/a'
    const last = Array.isArray(q?.queue) && q.queue.length ? { id: q.queue[0].id, type: q.queue[0].type, status: q.queue[0].status, progress: q.queue[0].progress } : null
    log.info('[AI→Workbench] 生成队列状态变更', {
      total, running, pending, success, failed, last,
    })
  } catch (e) {
    log.warn('[AI→Workbench] 队列统计输出异常（不影响业务）', { msg: e?.message })
  }
}

/* ==================== 角色一致性 Drawer (S3-T01) ==================== */
const charDrawerVisible = ref(false)
const selectedCharacter = ref(null)
function onConsistencyPanelUpdated(p) {
  // embedding 已更新 → 触发画布刷新
  ElMessage.success('角色指纹已更新：后续生图将自动使用新 embedding 进行一致性校验')
}
function onCharRegenerateReference() {
  ElMessageBox.confirm('将为该角色重新生图一张高清参考图，是否继续？', '重新生成角色参考图', { type: 'warning' })
    .then(async () => {
      try {
        // 调用 characterAPI.generateImage 生成角色参考（MySQL 存储记录由后端完成）
        const res = await characterAPI.generateImage(selectedCharacter.value?.id, '', 'cinematic')
        if (res?.data || res?.status === 200) {
          ElMessage.success('参考图已生成，请在 Drawer 中查看最新状态')
          wbCanvasRef.value?.refresh()
        }
      } catch (e) { ElMessage.error(e?.message || '生成失败') }
    })
    .catch(() => {})
}
function openCharacterEdit() {
  ElMessage.info('角色资料编辑表单：Sprint 4 深化（当前已接入创建 Drawer）')
}

/* ==================== 快速创建 Drawer（角色/场景/分镜写入MySQL） ==================== */
const createDrawerVisible = ref(false)
const createDrawerType = ref('character')
const createDrawerTitle = computed(() => ({
  character: '新建角色（写入数据库）',
  scene: '新建场景（写入数据库）',
  storyboard: '新建分镜（写入数据库）',
})[createDrawerType.value] || '新建')

const charForm = ref({ name: '', role: 'supporting', position: '', personality: '', background: '' })
const sceneForm = ref({ location: '', time: 'day', atmosphere: '' })
const sbForm = ref({ episode_id: null, action: '', dialogue: '', shot_type: 'MS', angle_s: 'eye_level' })

function openCreateDrawer(type) {
  createDrawerType.value = type
  charForm.value = { name: '', role: 'supporting', position: '', personality: '', background: '' }
  sceneForm.value = { location: '', time: 'day', atmosphere: '' }
  sbForm.value = {
    episode_id: (filterEpisodeId.value === 'all' ? drama.value?.episodes?.[0]?.id : filterEpisodeId.value) || null,
    action: '', dialogue: '', shot_type: 'MS', angle_s: 'eye_level',
  }
  createDrawerVisible.value = true
}

async function onSubmitCreateCharacter() {
  if (!charForm.value.name) return ElMessage.warning('请填写角色名')
  try {
    // 通过 dramas/:id/characters 接口写入（项目级角色列表）
    const newChar = {
      id: `new_${Date.now()}`,
      name: charForm.value.name,
      role: charForm.value.role,
      position: charForm.value.position,
      personality: charForm.value.personality,
      background: charForm.value.background,
    }
    const nextList = [...(drama.value?.characters || []), newChar]
    const res = await dramaAPI.saveCharacters(dramaId.value, { characters: nextList })
    if (res?.data || res?.status === 200) {
      ElMessage.success(`角色「${charForm.value.name}」已写入数据库`)
      createDrawerVisible.value = false
      await wbCanvasRef.value?.refresh()
    }
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

async function onSubmitCreateScene() {
  if (!sceneForm.value.location) return ElMessage.warning('请填写场景地点')
  try {
    const res = await sceneAPI.create({
      drama_id: dramaId.value,
      location: sceneForm.value.location,
      time: sceneForm.value.time,
      atmosphere: sceneForm.value.atmosphere,
    })
    if (res?.data) {
      ElMessage.success(`场景「${sceneForm.value.location}」已写入数据库`)
      createDrawerVisible.value = false
      await wbCanvasRef.value?.refresh()
    }
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

async function onSubmitCreateStoryboard() {
  if (!sbForm.value.episode_id) return ElMessage.warning('请选择所属集')
  if (!sbForm.value.action) return ElMessage.warning('请填写动作描述')
  try {
    const res = await storyboardsAPI.create({
      episode_id: sbForm.value.episode_id,
      action: sbForm.value.action,
      dialogue: sbForm.value.dialogue,
      shot_type: sbForm.value.shot_type,
      angle_s: sbForm.value.angle_s,
    })
    if (res?.data) {
      ElMessage.success('分镜已写入数据库')
      createDrawerVisible.value = false
      await wbCanvasRef.value?.refresh()
    }
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

/* ==================== S7: 智能工作流 + 智能剪辑 ==================== */
const wfOrchVisible = ref(false)
const wfMonitorVisible = ref(false)
const wfMonitorInstanceId = ref(null)
const smartEditRef = ref(null)

/** 打开工作流执行监控（可指定实例ID） */
function openWorkflowMonitor(instanceId = null) {
  wfMonitorInstanceId.value = instanceId
  wfMonitorVisible.value = true
}

/** 打开智能剪辑工作台 */
function openSmartEdit() {
  smartEditRef.value?.open()
}

/** 工作流实例创建后 → 自动打开执行监控 */
function onWorkflowInstanceCreated(instanceId) {
  if (instanceId) {
    wfOrchVisible.value = false
    openWorkflowMonitor(instanceId)
  }
}

/** 智能剪辑完成 → 刷新画布 */
function onEditCompleted(outputUrl) {
  log.info('[SmartEdit] 智能剪辑完成', { outputUrl })
  wbCanvasRef.value?.refresh?.()
}

/* ==================== 集数切换 & 路由跳转 ==================== */
function onFilterEpisodeChange() {
  canvasFocusSbId.value = null
  timelineFocusSbId.value = null
}
function goListMode() { router.push(`/drama/${dramaId.value}`) }
function goCanvasMode() { router.push(`/film/${dramaId.value}/canvas`) }
</script>

<style scoped>
.workbench-shell {
  position: fixed; inset: 0;
  display: flex; flex-direction: column;
  background: #f4f4f5;
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}
.is-dark { background: #0f172a; color: #f8fafc; }

/* ===== Header ===== */
.wb-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px; height: 56px; flex-shrink: 0;
  background: linear-gradient(90deg, #fff, #f8fafc 40%, #eef2ff 100%);
  border-bottom: 1px solid var(--el-border-color-lighter);
  z-index: 20;
}
.is-dark .wb-header {
  background: linear-gradient(90deg, #1e293b, #0f172a);
  border-bottom-color: #334155;
}
.wb-h-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.wb-logo { display: flex; align-items: baseline; gap: 6px; cursor: pointer; margin: 0; }
.wb-logo-main { font-size: 18px; font-weight: 700; background: linear-gradient(90deg, #4f46e5, #06b6d4); -webkit-background-clip: text; color: transparent; }
.wb-logo-sub { font-size: 12px; color: #6366f1; font-weight: 500; }
.wb-breadcrumb-sep { color: var(--el-border-color-darker); }
.wb-h-center { display: flex; align-items: center; gap: 12px; }
.wb-h-right { display: flex; align-items: center; gap: 6px; }
.wb-theme-btn { --el-button-bg-color: transparent; }

/* ===== Body ===== */
.wb-body {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
}
.wb-center-row {
  display: flex; flex-direction: row;
  min-height: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  position: relative;
}

/* 左栏 */
.wb-col-left {
  flex-shrink: 0; min-width: 0; position: relative;
  height: 100%;
}
/* 中栏 */
.wb-col-center {
  flex: 1; min-width: 0; height: 100%;
  position: relative;
}
/* 右栏 */
.wb-col-right {
  flex-shrink: 0; min-width: 0; position: relative;
  height: 100%;
}

/* 分隔条 */
.wb-resizer {
  position: absolute; top: 0; bottom: 0; width: 4px; z-index: 10;
  cursor: col-resize;
  transition: background .15s;
}
.wb-resizer:hover { background: rgba(99, 102, 241, .3); }
.wb-resizer-right { right: -2px; }
.wb-resizer-left  { left: -2px; }

/* 底部时间轴 */
.wb-timeline-row {
  flex-shrink: 0; min-height: 140px;
  position: relative;
  background: #fff;
}
.wb-timeline-resizer {
  position: absolute; top: -3px; left: 0; right: 0; height: 6px;
  cursor: row-resize; z-index: 11;
}
.wb-timeline-resizer:hover { background: rgba(99, 102, 241, .2); }

/* 创建 Drawer 底部 */
.wb-create-body { padding: 8px 4px 20px; }
.wb-create-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding-top: 16px; border-top: 1px solid var(--el-border-color-lighter);
}
</style>
