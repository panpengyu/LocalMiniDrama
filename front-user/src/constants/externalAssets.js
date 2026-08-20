/**
 * 演示/示例用外部资源 URL 集中管理（非环境配置）。
 *
 * 说明：
 *  - 以下 URL 均为「演示用」第三方图床地址（trae-api-cn.mchost.guru / lf-cdn.trae.com.cn），
 *    仅用于本地 UI 效果展示，属于静态展示资源，并非环境/凭证配置。
 *  - 部署到生产环境时，请将下列 URL 替换为自有 CDN 或本地静态资源路径
 *    （例如 /static/images/xxx.jpg），避免对第三方服务产生运行时依赖。
 *  - 如需调整展示内容，只需修改本文件，无需改动业务组件。
 */

const IDE_IMG = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=';

/** 首页 Hero 背景图（见 src/views/Home.vue） */
export const HERO_BG_URL =
  'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=cinematic%20dark%20blue%20gradient%20abstract%20background%20with%20dramatic%20lighting%20and%20sparkles%20professional%20ui%20design&image_size=landscape_16_9';

/** 侧边栏客服微信二维码（见 src/layouts/UserLayout.vue），生产请替换为自有二维码资源 */
export const WECHAT_QR_URL =
  'https://lf-cdn.trae.com.cn/obj/trae-ai-image/page_image/93f5b439665b51def2070e63f3651177.jpeg';

/** 图片生成工具 - 风格词库预览图（key 为风格名，见 tools/ImageGenerate.vue styleLibrary） */
export const STYLE_IMAGES = {
  写实人像: `${IDE_IMG}realistic%20portrait%20beautiful%20woman%2C%20soft%20lighting%2C%20professional%20photography&image_size=square_hd`,
  动漫少女: `${IDE_IMG}anime%20style%20cute%20girl%2C%20kawaii%2C%20anime%20art%2C%20colorful&image_size=square_hd`,
  赛博朋克: `${IDE_IMG}cyberpunk%20city%20night%2C%20neon%20lights%2C%20futuristic%2C%20high%20tech&image_size=square_hd`,
  古风山水: `${IDE_IMG}chinese%20traditional%20landscape%2C%20ink%20painting%2C%20mountains%2C%20misty&image_size=square_hd`,
  科幻星球: `${IDE_IMG}fantasy%20alien%20planet%2C%20science%20fiction%2C%20space%2C%20cosmic&image_size=square_hd`,
  暖光温馨: `${IDE_IMG}warm%20cozy%20room%2C%20soft%20warm%20lighting%2C%20comfortable%2C%20homey&image_size=square_hd`,
  冷色调: `${IDE_IMG}cold%20blue%20tone%2C%20mysterious%2C%20cool%20lighting%2C%20serene&image_size=square_hd`,
  油画风格: `${IDE_IMG}oil%20painting%20style%2C%20classical%20art%2C%20masterpiece&image_size=square_hd`,
};

/** 图片生成工具 - UI 示例样例预览图（key 为样例名，见 tools/ImageGenerate.vue samples） */
export const SAMPLE_IMAGES = {
  奇幻森林: `${IDE_IMG}magical%20fantasy%20forest%2C%20glowing%20mushrooms%2C%20fairies%2C%20magic%20atmosphere&image_size=square_hd`,
  未来战士: `${IDE_IMG}futuristic%20soldier%2C%20mechanical%20armor%2C%20cyberpunk%20style%2C%20battle%20pose&image_size=square_hd`,
  云端城堡: `${IDE_IMG}castle%20floating%20in%20clouds%2C%20dreamy%20sky%2C%20fantasy%20style&image_size=square_hd`,
  小满时节: `${IDE_IMG}chinese%20traditional%20solstice%20festival%2C%20pastoral%20scene%2C%20fresh%20natural&image_size=square_hd`,
  水墨山水: `${IDE_IMG}chinese%20ink%20wash%20painting%2C%20mountains%20and%20water%2C%20artistic&image_size=square_hd`,
  樱花少女: `${IDE_IMG}girl%20under%20cherry%20blossom%2C%20pink%20romantic%2C%20japanese%20style&image_size=square_hd`,
  星空夜景: `${IDE_IMG}starry%20night%20sky%2C%20milky%20way%2C%20romantic%2C%20beautiful&image_size=square_hd`,
  猫咪: `${IDE_IMG}cute%20cat%2C%20watercolor%20painting%2C%20soft%20lighting%2C%20fluffy&image_size=square_hd`,
};

/** 图片生成工具 - 模拟生成结果图（见 tools/ImageGenerate.vue 生成流程的 mock 数据） */
export const MOCK_GENERATED_IMAGES = [
  `${IDE_IMG}a%20giant%20blue%20whale%20swimming%20through%20the%20sky%20above%20a%20city%20skyline%2C%20clouds%20floating%20around%20its%20body%2C%20sunlight%20rays%20piercing%20through%20clouds%2C%20surreal%20fantasy%20scene%2C%20people%20watching%20from%20rooftops%2C%20dreamy%20atmosphere%2C%20cinematic%20lighting%2C%20ultra%20detailed&image_size=square_hd`,
  `${IDE_IMG}beautiful%20cyberpunk%20city%20at%20night%2C%20neon%20lights%2C%20flying%20cars%2C%20holographic%20billboards%2C%20rain%20reflections%2C%20futuristic%20architecture%2C%20cyberpunk%20aesthetic%2C%20cinematic%20lighting%2C%20ultra%20realistic&image_size=square_hd`,
  `${IDE_IMG}ancient%20chinese%20palace%2C%20traditional%20architecture%2C%20cherry%20blossoms%2C%20misty%20mountains%2C%20golden%20light%2C%20ink%20painting%20style%2C%20serene%20atmosphere%2C%20oriental%20beauty%2C%20cinematic&image_size=square_hd`,
  `${IDE_IMG}futuristic%20space%20station%2C%20stars%20in%20background%2C%20earth%20visible%2C%20advanced%20technology%2C%20blue%20energy%20fields%2C%20science%20fiction%2C%20epic%20scale%2C%20cinematic%20lighting&image_size=square_hd`,
];
