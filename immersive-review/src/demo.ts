import { t } from './i18n';
/** Public Pages builds have no backend and must never collect or send API keys. */
export const IS_DEMO_MODE = import.meta.env.MODE === 'demo';
export const demoAiNotice = () => t('本地部署可连接模型。', 'Available in local installations.');
