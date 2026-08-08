/**
 * =============================================================
 * Sprint 2 新功能 · 浏览器 DevTools Console Mock 测试脚本
 * 使用方式：
 *   1. 先登录系统 → 打开任意前端页面（如 /screenwriter-studio）
 *   2. 按 F12 → Console → 粘贴整段代码并回车
 *   3. 会按顺序生成：大纲 → 角色 → 单幕重写 → 单角色AI重写
 *   4. 每一步输出 object，包含 outlineId / characterId 可用于后续测试
 * =============================================================
 *
 * 路由总览：
 *   POST /api/v1/ai/screenwriter/outline/sync      → 生成大纲
 *   POST /api/v1/ai/screenwriter/characters/sync   → 生成完整角色（需要 outline_id）
 *   POST /api/v1/ai/screenwriter/outlines/:outlineId/regenerate-act  → 单幕重写（新）
 *   PATCH /api/v1/ai/screenwriter/characters/:characterId            → 角色保存（新）
 *   POST /api/v1/ai/screenwriter/characters/:characterId/regenerate  → 单角色AI重写（新）
 */

const BASE = '/api/v1/ai/screenwriter';

async function post(path, body) {
  const resp = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok || !data.success) {
    console.error(`❌ ${path} 失败:`, data);
    throw new Error(data.message || `HTTP ${resp.status}`);
  }
  console.log(`✅ ${path} 返回:`, data.data ?? data.result ?? data);
  return data.data ?? data.result ?? data;
}

async function patch(path, body) {
  const resp = await fetch(BASE + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok || !data.success) {
    console.error(`❌ ${path} 失败:`, data);
    throw new Error(data.message || `HTTP ${resp.status}`);
  }
  console.log(`✅ ${path} 返回:`, data.data ?? data.result ?? data);
  return data.data ?? data.result ?? data;
}

async function runAllMockSteps() {
  console.group('🚀 Sprint 2 新功能完整 Mock 测试');
  try {
    // ------------------------------------------------------------
    // STEP 1: 生成大纲（三幕式结构 → 方便测试 S2-T01/T02 单幕重写/拖拽）
    // ------------------------------------------------------------
    console.log('\n==== Step 1: 生成大纲（三幕式） ====');
    const outlineReq = {
      idea: '一个落魄的天才作曲家在古董店发现一支神秘乐谱，每次弹奏都会让他穿越到1920年的上海百乐门，与当年的当红女歌星共同谱写一首改变时代命运的歌曲，但每一次穿越他的记忆都会被抽取一部分作为代价。',
      title: '百乐门·回声曲',
      genre: 'fantasy_romance',
      style: 'nostalgic',
      structure: 'three_act',
      episode_count: 8,
    };
    const outlineResult = await post('/outline/sync', outlineReq);
    // 兼容多种返回结构
    const outline = outlineResult.outline || outlineResult.result || outlineResult;
    const outlineId = outline.outlineId || outline.outline_id || outline.id;
    const acts = outline.acts || outline.act_list || outline.structure || [];
    console.log('📌 拿到大纲: ', { outlineId, title: outline.title, 分幕数: acts.length });
    if (acts.length > 0) {
      acts.forEach((a, i) => console.log(`   第${i + 1}幕标题: ${a.title}（摘要${(a.summary || '').length}字，${(a.key_events || []).length}个关键事件）`));
    }

    // ------------------------------------------------------------
    // STEP 2: 生成 4~6 个角色（方便测试 S2-T03 角色保存/AI重写）
    // ------------------------------------------------------------
    console.log('\n==== Step 2: 生成角色（4 个定位） ====');
    const charsResult = await post('/characters/sync', {
      outline_id: outlineId,
      idea: outlineReq.idea,
      title: outlineReq.title,
      character_count: 5,
    });
    const characters = charsResult.characters || charsResult.result || charsResult.items || charsResult;
    console.log(`📌 拿到 ${characters.length} 个角色:`);
    characters.forEach((c) => console.log(`   · ${c.name}（${c.role || '未设定位'}）外貌${(c.appearance || '').length}字`));

    if (characters.length < 1 || acts.length < 2) {
      throw new Error('生成的数据量不足，无法继续测试新功能');
    }
    const firstChar = characters[0];
    const firstCharId = firstChar.characterId || firstChar.character_id || firstChar.id;
    const firstActIdx = Math.min(1, acts.length - 1); // 测试第 2 幕（或最后一幕）

    // ------------------------------------------------------------
    // STEP 3: 【S2-T01 新功能】单幕重写 regenerate-act
    // ------------------------------------------------------------
    console.log(`\n==== Step 3: 【S2-T01】单幕重写（第 ${firstActIdx + 1} 幕） ====`);
    const regenActReq = {
      act_index: firstActIdx,
      actIndex: firstActIdx, // 兼容 camelCase 与 snake_case
      prompt_append: '在这一幕加入主角意外触碰乐谱导致 1920 年歌舞厅发生时空涟漪，众人突然定格 3 秒，主角第一次意识到穿越并非完全自由，而是有看不见的规则限制。强化悬疑和神秘氛围。',
      idea: outlineReq.idea,
    };
    const regenActResult = await post(`/outlines/${outlineId}/regenerate-act`, regenActReq);
    const newAct = regenActResult.act || regenActResult;
    console.log('📌 重写后新幕: ', {
      act_number: newAct.act_number,
      title: newAct.title,
      摘要字数: (newAct.summary || '').length,
      关键事件数: (newAct.key_events || []).length,
      关键事件: newAct.key_events,
    });

    // ------------------------------------------------------------
    // STEP 4: 【S2-T03 新功能】角色保存（手动修改外貌、性格、背景）
    // ------------------------------------------------------------
    console.log(`\n==== Step 4: 【S2-T03】保存角色编辑（${firstChar.name}） ====`);
    const savePatch = {
      name: firstChar.name,
      role: firstChar.role || 'protagonist',
      appearance: `${firstChar.appearance || ''} 新增细节：左耳有一颗琥珀色小耳钉，是母亲留给她的唯一遗物；左手指尖有常年握笔留下的薄茧。`,
      personality: `${firstChar.personality || ''} 新增反差：表面乐观爱笑，但在独处时会反复摩挲耳钉，是她隐藏脆弱的小动作。`,
      background: `${firstChar.background || ''} 补充：3 岁那年父亲抛弃家庭，母亲独自经营裁缝店维持生计，17 岁时母亲在一场大火中去世，从此成为孤儿。`,
    };
    const savedChar = await patch(`/characters/${firstCharId}`, savePatch);
    console.log('📌 保存后角色字段更新值: ', {
      name: savedChar.name,
      role: savedChar.role,
      外貌字数: (savedChar.appearance || '').length,
      性格字数: (savedChar.personality || '').length,
      背景字数: (savedChar.background || '').length,
    });

    // ------------------------------------------------------------
    // STEP 5: 【S2-T03 新功能】单角色 AI 重写 regenerateCharacter
    // ------------------------------------------------------------
    console.log(`\n==== Step 5: 【S2-T03】单角色 AI 重写（${firstChar.name}） ====`);
    const regenCharResult = await post(`/characters/${firstCharId}/regenerate`, {
      prompt_append: '让女主角的外貌带有 1920 年代上海摩登风格的复古质感（柳叶细眉 / 波浪卷发 / 珍珠耳饰 / 剪裁合体的旗袍），性格上增加「表面顺从内心极度倔强」这一核心反差，背景加入「父亲其实是音乐大师但隐姓埋名」的伏笔',
      outline_id: outlineId,
      idea: outlineReq.idea,
    });
    const regenChar = regenCharResult.character || regenCharResult;
    console.log('📌 AI 重写后的角色档案: ', {
      name: regenChar.name,
      role: regenChar.role,
      appearance: (regenChar.appearance || '').slice(0, 120) + '...',
      personality: (regenChar.personality || '').slice(0, 80) + '...',
      background: (regenChar.background || '').slice(0, 80) + '...',
      motivation: regenChar.motivation,
      arc: regenChar.arc,
    });

    // ------------------------------------------------------------
    // 总结：可用于前端手动联调
    // ------------------------------------------------------------
    console.log('\n==== ✅ 全部 5 个步骤完成 ====');
    const summary = {
      outlineId,
      大纲标题: outline.title,
      大纲分幕数: acts.length,
      角色数: characters.length,
      主角角色ID: firstCharId,
      主角姓名: regenChar?.name || savedChar?.name,
      建议: '请回到 ScreenwriterStudio 页面，使用上述 outlineId 的大纲数据，点击幕卡右上角「重写」与角色卡片底部「保存修改 / AI 重写」按钮验证完整交互流程。',
    };
    console.table(summary);
    // 挂载到 window 上便于手动继续调用
    window.__SPRINT2_MOCK__ = summary;
    window.__SPRINT2_MOCK__.characters = characters;
    window.__SPRINT2_MOCK__.acts = outline.acts || acts;
    console.groupEnd();
    return summary;
  } catch (e) {
    console.groupEnd();
    console.error('❌ Mock 测试流程中断于:', e);
    throw e;
  }
}

// 自动启动
runAllMockSteps().catch((e) => console.error('请先登录系统并在前端页内执行本脚本，失败原因:', e.message));
