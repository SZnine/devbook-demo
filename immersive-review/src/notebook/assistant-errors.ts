import { getLanguage } from '../i18n';

// Translate only messages owned by our server. Provider responses are left intact.
const messages: Record<string, string> = {
  '请填写有效的 API 地址。': 'Enter a valid API URL.',
  '请填写完整的 API 地址。': 'Enter the full API URL.',
  'API 地址需要使用 HTTPS；本机服务可使用 HTTP。': 'Use HTTPS, or HTTP for a local provider.',
  'API 地址不能包含用户名、密码、查询参数或片段。': 'API URLs cannot contain credentials, query parameters or fragments.',
  '模型列表最多可设置 30 项。': 'Add up to 30 models.',
  '请填写有效的模型名称。': 'Enter a valid model ID.',
  'API Key 格式无效。': 'Invalid API key format.',
  '只允许从本机工作台访问助手。': 'Open the assistant from your local workspace.',
  '请从已配置的工作台地址访问助手。': 'Use the configured workspace address.',
  '请求来源无效。': 'Invalid request origin.',
  '请从当前工作台发起请求。': 'Send this request from the current workspace.',
  '请求必须使用 JSON 格式。': 'The request must use JSON.',
  '发送内容超过服务器允许的大小，请减少内容后重试。': 'Request is too large. Reduce its content and try again.',
  '请求内容不是有效的 JSON。': 'Invalid JSON request.',
  '请求内容格式无效。': 'Invalid request format.',
  '一次对话需要包含 1 至 60 条消息，请新建对话后继续。': 'Start a new chat to continue. Each request supports up to 60 messages.',
  '消息需要包含有效的角色和正文。': 'Each message needs a valid role and body.',
  '单条消息超过 10 万字符，请减少内容后重试。': 'Message exceeds 100,000 characters. Shorten it and try again.',
  '对话累计超过 40 万字符，请新建对话或减少内容。': 'Conversation exceeds 400,000 characters. Start a new chat.',
  '最后一条消息必须是用户提问。': 'The last message must be from the user.',
  'API 认证失败，请检查该服务的 API Key 和访问权限。': 'Authentication failed. Check the API key and permissions.',
  '服务暂时限流或额度不足，请检查账户额度后重试。': 'Rate limit or quota reached. Check your provider account.',
  'API 地址或模型不存在，请检查设置。': 'API URL or model not found. Check provider settings.',
  '模型未接受本次请求，请检查模型名称或减少发送内容。': 'The model rejected this request. Check the model ID or shorten the content.',
  '无法读取助手配置，请检查数据目录中的 assistant-config.json。': 'Could not read assistant-config.json in the data directory.',
  '本机助手配置格式无效。': 'Invalid local provider configuration.',
  '请选择有效的 AI 服务。': 'Select a valid provider.',
  '清除密钥选项格式无效。': 'Invalid remove-key option.',
  '不能同时替换和清除 API Key。': 'Choose either replacing or removing the API key.',
  '更换 API 域名时，请重新填写 API Key 或清除原密钥。': 'Re-enter or remove the API key when changing the API domain.',
  '请先在助手设置中填写该服务的 API Key 和模型。': 'Add an API key and model in provider settings.',
  '所选模型未配置，请在助手设置中添加或重新选择。': 'Model not configured. Add it in settings or choose another.',
  '服务返回了不支持的内容，请检查 API 地址是否为兼容接口。': 'Unsupported response. Check that the API endpoint is compatible.',
  'AI 服务没有返回内容。': 'The provider returned an empty response.',
  '回答超过长度限制，请缩小问题范围后重试。': 'Response is too long. Narrow the question and try again.',
  'AI 服务返回了无法解析的回答。': 'The provider returned an invalid response.',
  '等待回答超时，已停止本次连接；你可以稍后重试。': 'Response timed out. Try again.',
  '无法连接 AI 服务，请检查 API 地址和网络后重试。': 'Could not connect. Check the API URL and network.',
  '评分超时，未保存任何评分；可以稍后重试。': 'Scoring timed out. No changes were saved.',
  '不能通过网页访问本机私有配置。': 'Private configuration is not accessible from the web.',
  '该接口不支持此请求方式。': 'Request method not supported.',
  '本机助手服务暂时不可用，请稍后重试。': 'The local assistant service is unavailable. Try again.',
  '评分只接受节章标题和简短摘要，不接受完整正文或其他字段。': 'Scoring accepts headings and short summaries, not full content.',
  '一次只能比较 1 至 20 项最近浏览的内容。': 'Compare 1 to 20 recent items at a time.',
  '评分只接受内容 ID、版本、节章标题和简短摘要，不接受完整正文。': 'Scoring accepts item IDs, versions, headings and short summaries.',
  '评估内容 ID 不能重复。': 'Scoring item IDs must be unique.',
  '本批标题和摘要超过 16,000 字符，请减少比较项后重试。': 'Headings and summaries exceed 16,000 characters. Compare fewer items.',
  '模型未返回有效的评分结果，请重试。': 'Invalid scoring response. Try again.',
  '评分结果因长度限制被截断，未保存任何评分，请减少内容后重试。': 'Scoring response was truncated. No changes were saved.',
  '服务商过滤了评分结果，未保存任何评分。': 'The provider filtered the response. No scores were saved.',
  '模型未正常完成评分，未保存任何评分，请重试。': 'Scoring did not finish. No changes were saved.',
  '模型未返回可用的评分正文，请重试。': 'The model returned no usable scores. Try again.',
  '模型评分不是完整 JSON，未保存任何评分，请重试。': 'Incomplete scoring response. No changes were saved.',
  '模型返回的评分项不完整，未保存任何评分。': 'Incomplete score list. No changes were saved.',
  '模型返回的内容 ID 不匹配，未保存任何评分。': 'Scoring item IDs did not match. No changes were saved.',
  '模型排名不完整或出现并列，未保存任何评分。': 'Invalid ranking. No changes were saved.',
  '模型比较理由格式无效，未保存任何评分。': 'Invalid scoring reasons. No changes were saved.',
  'API 认证失败，请检查所选模型服务的 API Key。': 'Authentication failed. Check the provider API key.',
  '服务限流或额度不足，请稍后重试。': 'Rate limit or quota reached. Try again later.',
  'API 地址或模型不存在，请检查助手设置。': 'API URL or model not found. Check provider settings.',
  '模型未能完成评分，请检查模型设置后重试。': 'Scoring failed. Check model settings and try again.',
  '模型服务未返回 JSON 响应，请检查兼容接口设置。': 'Expected a JSON response. Check endpoint compatibility.',
  '模型评分响应超过长度限制，未保存任何评分。': 'Scoring response is too large. No changes were saved.',
  '模型服务返回了无法解析的响应。': 'The provider returned an invalid response.',
};

export function assistantErrorMessage(message: string): string {
  if (getLanguage() !== 'en') return message;
  if (messages[message]) return messages[message];
  const unavailable = /^AI 服务暂时无法响应（(\d{3})），请稍后重试。$/.exec(message);
  if (unavailable) return `Provider unavailable (${unavailable[1]}). Try again.`;
  const invalidField = /^(AI 服务|模型|学习方向|内容 ID|内容版本|内容标题|章节标题|小节标题|内容摘要)格式无效或超过 (\d+) 字符。$/.exec(message);
  if (invalidField) return `Invalid scoring field or length exceeds ${invalidField[2]} characters.`;
  return message;
}
