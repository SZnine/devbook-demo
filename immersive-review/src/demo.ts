/** Public Pages builds have no backend and must never collect or send API keys. */
export const IS_DEMO_MODE = import.meta.env.MODE === 'demo';
export const DEMO_AI_NOTICE = '在线演示不连接 AI 服务；本地部署后可配置。';
