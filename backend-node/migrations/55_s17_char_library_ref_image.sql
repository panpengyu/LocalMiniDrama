-- S17: character_libraries 补齐 ref_image 列
-- consistencyService.generateCharacterEmbedding 查询引用 ref_image，
-- 但真实表缺失（SQLite 临时表掩盖了该缺陷），此处补齐。
ALTER TABLE character_libraries ADD COLUMN ref_image VARCHAR(500) NULL;
