/**
 * S15-T04 开放平台在线 API 文档（Swagger UI + 纯 JSON spec）
 * 挂载：/api/v1/open/docs（Swagger UI）、/api/v1/open/docs/openapi.json（JSON）
 */
const express = require('express');
const swaggerUi = require('swagger-ui-express');

module.exports = function openDocsRouter(spec) {
  const router = express.Router();
  router.use('/', swaggerUi.serve, swaggerUi.setup(spec, {
    customSiteTitle: 'LocalMiniDrama 开放平台 API 文档',
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
  }));
  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(spec);
  });
  return router;
};
