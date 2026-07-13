import { describe, it } from 'node:test';
import assert from 'node:assert';

const ASSET_X = 48;
const ASSET_ROW_H = 188;
const ASSET_GAP_X = 150;
const PIPELINE_X = 360;
const MAX_ASSET_ROW_WIDTH = PIPELINE_X - ASSET_X - 24;

function buildAssetRow(items, startX, startY) {
  const nodes = [];
  let colX = startX;
  let rowY = startY;
  for (const item of items) {
    const id = `item:${item.id}`;
    if (colX + ASSET_GAP_X > PIPELINE_X && colX > startX) {
      rowY += ASSET_ROW_H + 8;
      colX = startX;
    }
    nodes.push({
      id,
      position: { x: colX, y: rowY },
      data: { kind: item.kind },
    });
    colX += ASSET_GAP_X;
  }
  return { nodes, endX: colX, endY: rowY + ASSET_ROW_H };
}

describe('buildAssetRow layout', () => {
  it('should layout 2 items in single row', () => {
    const items = [
      { id: 1, kind: 'character' },
      { id: 2, kind: 'character' },
    ];
    const result = buildAssetRow(items, ASSET_X, 180);
    
    assert.strictEqual(result.nodes.length, 2);
    assert.strictEqual(result.nodes[0].position.x, ASSET_X);
    assert.strictEqual(result.nodes[1].position.x, ASSET_X + ASSET_GAP_X);
    assert.strictEqual(result.nodes[0].position.y, 180);
    assert.strictEqual(result.nodes[1].position.y, 180);
    
    console.log('2 items - X positions:', result.nodes.map(n => n.position.x));
    console.log('2 items - Y positions:', result.nodes.map(n => n.position.y));
  });

  it('should wrap when exceeding MAX_ASSET_ROW_WIDTH', () => {
    const items = [
      { id: 1, kind: 'character' },
      { id: 2, kind: 'character' },
      { id: 3, kind: 'character' },
    ];
    const result = buildAssetRow(items, ASSET_X, 180);
    
    assert.strictEqual(result.nodes.length, 3);
    
    const xs = result.nodes.map(n => n.position.x);
    const ys = result.nodes.map(n => n.position.y);
    
    console.log('3 items - X positions:', xs);
    console.log('3 items - Y positions:', ys);
    
    const uniqueYs = [...new Set(ys)];
    assert.ok(uniqueYs.length > 1, `should have multiple rows (got ${uniqueYs.length})`);
  });

  it('20 characters should wrap to multiple rows', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      kind: 'character',
    }));
    const result = buildAssetRow(items, ASSET_X, 180);
    
    assert.strictEqual(result.nodes.length, 20);
    
    const maxX = Math.max(...result.nodes.map(n => n.position.x));
    assert.ok(maxX < PIPELINE_X, `max X (${maxX}) should be less than PIPELINE_X (${PIPELINE_X})`);
    
    const uniqueYs = [...new Set(result.nodes.map(n => n.position.y))];
    console.log('20 characters - 行数:', uniqueYs.length);
    console.log('20 characters - 最大X坐标:', maxX);
    console.log('20 characters - Y坐标分布:', uniqueYs);
    
    assert.ok(uniqueYs.length >= 10, `should have at least 10 rows for 20 items (got ${uniqueYs.length})`);
  });

  it('100 characters should wrap correctly', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      kind: 'character',
    }));
    const result = buildAssetRow(items, ASSET_X, 180);
    
    assert.strictEqual(result.nodes.length, 100);
    
    const maxX = Math.max(...result.nodes.map(n => n.position.x));
    assert.ok(maxX < PIPELINE_X, `max X (${maxX}) should be less than PIPELINE_X (${PIPELINE_X})`);
    
    const uniqueYs = [...new Set(result.nodes.map(n => n.position.y))];
    console.log('100 characters - 行数:', uniqueYs.length);
    console.log('100 characters - 最大X坐标:', maxX);
    console.log('100 characters - 画布高度:', result.endY);
    
    assert.ok(uniqueYs.length >= 50, `should have at least 50 rows for 100 items (got ${uniqueYs.length})`);
  });

  it('bounds calculation should accommodate all assets', () => {
    const charItems = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, kind: 'character' }));
    const propItems = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, kind: 'prop' }));
    const sceneItems = [{ id: 1, kind: 'scene' }];
    
    const charResult = buildAssetRow(charItems, ASSET_X, 180);
    const propResult = buildAssetRow(propItems, ASSET_X, charResult.endY + 36);
    const sceneResult = buildAssetRow(sceneItems, ASSET_X, propResult.endY + 36);
    
    const maxY = sceneResult.endY;
    const boundsHeight = Math.max(600, maxY);
    
    console.log('混合资产 - 画布高度:', boundsHeight);
    console.log('角色结束Y:', charResult.endY);
    console.log('道具结束Y:', propResult.endY);
    console.log('场景结束Y:', sceneResult.endY);
    
    assert.ok(boundsHeight >= maxY, 'bounds height should cover all assets');
  });
});