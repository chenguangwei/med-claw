import type { ComponentType } from 'react';
import { API_BASE_URL } from '@/config';
import type { Settings as SettingsType } from '@/shared/db/settings';
import {
  BrainCircuit,
  Calculator,
  Database,
  FileText,
  Mic,
  ShieldCheck,
} from 'lucide-react';

import { getMcpIconOption } from './mcp-icon-library';

export type CapabilityExtensionCategory =
  | '全部'
  | 'MCP 服务'
  | '医疗健康'
  | '语音识别'
  | '文档智能'
  | '业务风控'
  | '数据处理';

export type CapabilityExtensionKind = 'official' | 'mcp';

export type McpTransportType = 'stdio' | 'http' | 'sse';

export interface McpCapabilityConfigTemplate {
  serverName: string;
  transportType: McpTransportType;
  url?: string;
  command?: string;
  args?: string[];
  icon?: string;
}

export interface CapabilityExtension {
  id: string;
  kind: CapabilityExtensionKind;
  name: string;
  description: string;
  category: CapabilityExtensionCategory;
  tags: string[];
  provider: string;
  usage: string;
  connected: boolean;
  featured?: boolean;
  icon: ComponentType<{ className?: string }>;
  accent: string;
  instruction: string;
  mcpServerName?: string;
  mcpConfigTemplate?: McpCapabilityConfigTemplate;
  iconKey?: string;
}

export const capabilityExtensionCategories: CapabilityExtensionCategory[] = [
  '全部',
  'MCP 服务',
  '医疗健康',
  '语音识别',
  '文档智能',
  '业务风控',
  '数据处理',
];

export const officialCapabilityExtensions: CapabilityExtension[] = [
  {
    id: 'claim-calculation',
    kind: 'mcp',
    name: '理算技能',
    description:
      '面向保险理赔场景，自动识别责任、保额、免赔额与赔付规则，输出可追溯的理算结果。',
    category: '医疗健康',
    tags: ['MCP 服务', 'http', '责任判断', '赔付试算', '规则引擎'],
    provider: 'U2 MCP 模板',
    usage: '18.6k 调用',
    connected: false,
    featured: true,
    icon: Calculator,
    accent: 'from-orange-100 to-amber-50 text-orange-500 border-orange-100',
    instruction: '使用理算技能进行责任判断、赔付试算和结果追溯。',
    mcpServerName: 'u2_claim_calculation',
    iconKey: 'calculator',
    mcpConfigTemplate: {
      serverName: 'u2_claim_calculation',
      transportType: 'http',
      url: 'https://mcp.uniins.local/insurance/claim-calculation/mcp',
      icon: 'calculator',
    },
  },
  {
    id: 'medical-insurance-audit',
    kind: 'official',
    name: '医保审核技能',
    description:
      '校验医保目录、诊疗项目、用药合规与报销限制，辅助完成费用合规审核。',
    category: '医疗健康',
    tags: ['医保目录', '费用审核', '合规校验'],
    provider: 'U2 能力',
    usage: '12.8k 调用',
    connected: false,
    icon: ShieldCheck,
    accent: 'from-emerald-100 to-teal-50 text-emerald-600 border-emerald-100',
    instruction: '使用医保审核技能校验医保目录、费用项目和报销合规性。',
  },
  {
    id: 'asr',
    kind: 'official',
    name: 'ASR 技能',
    description:
      '将录音、通话与会议音频转写为结构化文本，支持说话人分离与关键词抽取。',
    category: '语音识别',
    tags: ['语音转写', '说话人分离', '关键词'],
    provider: 'U2 能力',
    usage: '32.1k 调用',
    connected: true,
    icon: Mic,
    accent: 'from-indigo-100 to-blue-50 text-indigo-600 border-indigo-100',
    instruction: '使用 ASR 技能处理音频转写、说话人分离和关键词抽取。',
  },
  {
    id: 'ocr',
    kind: 'official',
    name: 'OCR 技能',
    description:
      '识别发票、保单、病历、身份证与表格影像内容，输出字段级结构化结果。',
    category: '文档智能',
    tags: ['票据识别', '证照识别', '结构化抽取'],
    provider: 'U2 能力',
    usage: '28.4k 调用',
    connected: true,
    icon: FileText,
    accent: 'from-sky-100 to-cyan-50 text-sky-600 border-sky-100',
    instruction: '使用 OCR 技能识别票据、证照、保单、病历和表格影像内容。',
  },
  {
    id: 'risk-control',
    kind: 'official',
    name: '风控核验技能',
    description:
      '结合业务规则与历史行为信号，识别异常申报、重复材料和高风险操作。',
    category: '业务风控',
    tags: ['异常检测', '重复核验', '风险评分'],
    provider: 'U2 能力',
    usage: '9.7k 调用',
    connected: false,
    icon: BrainCircuit,
    accent: 'from-violet-100 to-purple-50 text-violet-600 border-violet-100',
    instruction: '使用风控核验技能识别异常申报、重复材料和高风险操作。',
  },
  {
    id: 'data-normalization',
    kind: 'official',
    name: '数据标准化技能',
    description:
      '清洗业务表单与接口返回数据，统一字段命名、枚举值、单位和日期格式。',
    category: '数据处理',
    tags: ['字段映射', '数据清洗', '格式统一'],
    provider: 'U2 能力',
    usage: '7.3k 调用',
    connected: false,
    icon: Database,
    accent: 'from-cyan-100 to-teal-50 text-cyan-600 border-cyan-100',
    instruction: '使用数据标准化技能清洗字段、枚举值、单位和日期格式。',
  },
];

function createMcpCapabilityExtension({
  id,
  name,
  description,
  tags,
  provider,
  usage,
  serverName,
  transportType,
  url,
  icon,
}: {
  id: string;
  name: string;
  description: string;
  tags: string[];
  provider: string;
  usage: string;
  serverName: string;
  transportType: McpTransportType;
  url: string;
  icon: string;
}): CapabilityExtension {
  const iconOption = getMcpIconOption(icon);

  return {
    id,
    kind: 'mcp',
    name,
    description,
    category: 'MCP 服务',
    tags: ['MCP 服务', transportType, ...tags],
    provider,
    usage,
    connected: false,
    icon: iconOption.icon,
    accent: iconOption.accent,
    instruction: `使用 ${name} MCP 服务提供的真实工具能力。`,
    mcpServerName: serverName,
    iconKey: icon,
    mcpConfigTemplate: {
      serverName,
      transportType,
      url,
      icon,
    },
  };
}

export const mockMcpCapabilityExtensions: CapabilityExtension[] = [
  createMcpCapabilityExtension({
    id: 'mock-mcp-sales-knowledge-base',
    name: '销售知识库',
    description:
      '连接产品资料、销售手册和内部 FAQ，为助手提供条款检索、口径查询和产品说明能力。',
    tags: ['知识库', '产品资料', '销售 FAQ'],
    provider: 'MCP 示例库',
    usage: 'http 示例',
    serverName: 'sales_knowledge_base',
    transportType: 'http',
    url: 'https://mcp.example.com/sales-knowledge-base/mcp',
    icon: 'knowledge',
  }),
  createMcpCapabilityExtension({
    id: 'mock-mcp-policy-system',
    name: '保单系统',
    description:
      '模拟查询客户、保单、续保和承保状态，适合演示业务系统 MCP 接入流程。',
    tags: ['保单查询', '续保状态', '承保'],
    provider: 'MCP 示例库',
    usage: 'http 示例',
    serverName: 'policy_system',
    transportType: 'http',
    url: 'https://mcp.example.com/policy-system/mcp',
    icon: 'policy',
  }),
  createMcpCapabilityExtension({
    id: 'mock-mcp-crm',
    name: '客户中心',
    description:
      '模拟读取客户画像、渠道来源和跟进记录，用于销售、客服和运营助手场景。',
    tags: ['客户画像', '渠道', '跟进记录'],
    provider: 'MCP 示例库',
    usage: 'sse 示例',
    serverName: 'customer_center',
    transportType: 'sse',
    url: 'https://mcp.example.com/customer-center/sse',
    icon: 'crm',
  }),
  createMcpCapabilityExtension({
    id: 'mock-mcp-ticketing',
    name: '运维工单',
    description:
      '模拟创建排障工单、补充上下文和查询处理进度，适合内部流程自动化。',
    tags: ['工单', '排障', '流程'],
    provider: 'MCP 示例库',
    usage: 'http 示例',
    serverName: 'ops_ticketing',
    transportType: 'http',
    url: 'https://mcp.example.com/ops-ticketing/mcp',
    icon: 'ticket',
  }),
];

export function buildMcpAllConfigsUrl(settings?: SettingsType): string | null {
  if (settings?.mcpEnabled === false) return null;

  const params = new URLSearchParams();
  if (settings) {
    params.set('userDirEnabled', String(settings.mcpUserDirEnabled !== false));
    params.set('appDirEnabled', String(settings.mcpAppDirEnabled !== false));
    if (settings.mcpConfigPath) {
      params.set('mcpConfigPath', settings.mcpConfigPath);
    }
  }

  const query = params.toString();
  return `${API_BASE_URL}/mcp/all-configs${query ? `?${query}` : ''}`;
}

export async function loadConfiguredMcpCapabilityExtensions(
  settings?: SettingsType
): Promise<CapabilityExtension[]> {
  const url = buildMcpAllConfigsUrl(settings);
  if (!url) return [];

  const response = await fetch(url);
  const result = await response.json();
  if (!result.success || !Array.isArray(result.configs)) return [];

  const abilities: CapabilityExtension[] = [];
  const seen = new Set<string>();

  for (const configInfo of result.configs as Array<{
    name: string;
    exists: boolean;
    servers: Record<
      string,
      { command?: string; url?: string; type?: string; icon?: string }
    >;
  }>) {
    if (!configInfo.exists) continue;

    for (const [serverName, serverConfig] of Object.entries(
      configInfo.servers || {}
    )) {
      if (seen.has(serverName)) continue;
      seen.add(serverName);

      const transport = serverConfig.url
        ? ((serverConfig.type || 'http') as McpTransportType)
        : 'stdio';
      const iconOption = getMcpIconOption(serverConfig.icon);
      const provider =
        configInfo.name === 'claude'
          ? 'Claude 配置'
          : configInfo.name === 'custom'
            ? '自定义配置'
            : 'uniins-claw';

      abilities.push({
        id: `configured-mcp-${serverName}`,
        kind: 'mcp',
        name: serverName,
        description: `本机已配置的 ${transport} MCP 服务，可在助手中作为真实工具服务挂载。`,
        category: 'MCP 服务',
        tags: ['MCP 服务', transport, configInfo.name],
        provider,
        usage: `${configInfo.name} 配置`,
        connected: true,
        icon: iconOption.icon,
        accent: iconOption.accent,
        instruction: `使用 ${serverName} MCP 服务提供的真实工具能力。`,
        mcpServerName: serverName,
        iconKey: serverConfig.icon,
        mcpConfigTemplate: {
          serverName,
          transportType: transport,
          url: serverConfig.url,
          command: serverConfig.command,
          icon: serverConfig.icon,
        },
      });
    }
  }

  return abilities;
}
