ALTER TABLE character_libraries ADD COLUMN appearance VARCHAR(2000);
ALTER TABLE character_libraries ADD COLUMN identity_anchors VARCHAR(2000);
ALTER TABLE character_libraries ADD COLUMN style_tokens VARCHAR(500);
ALTER TABLE character_libraries ADD COLUMN color_palette VARCHAR(500);
ALTER TABLE character_libraries ADD COLUMN four_view_image_url VARCHAR(500);

ALTER TABLE characters ADD COLUMN identity_anchors VARCHAR(2000);
ALTER TABLE characters ADD COLUMN style_tokens VARCHAR(500);
ALTER TABLE characters ADD COLUMN color_palette VARCHAR(500);
ALTER TABLE characters ADD COLUMN four_view_image_url VARCHAR(500);